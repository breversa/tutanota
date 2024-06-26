use std::cmp::PartialEq;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use base64::Engine;
use base64::prelude::{BASE64_STANDARD, BASE64_URL_SAFE};

use crate::{ApiCallError, IdTuple};
use crate::ApiCallError::InternalSdkError;
use crate::crypto::aes::{Aes128Key, Aes256Key, aes_128_decrypt, aes_256_decrypt, GenericAesKey};
use crate::crypto::aes::GenericAesKey::{Aes128, Aes256};
use crate::crypto::argon2_id::generate_key_from_passphrase;
use crate::crypto::sha::sha256;
use crate::entities::{Entity, Id};
use crate::entities::sys::{GroupInfo, Session, User};
use crate::entity_client::{EntityClient, IdType};
use crate::instance_mapper::InstanceMapper;
use crate::login_controller::{Credentials, ExternalUserKeyDeriver, KdfType};
use crate::login_listener::{LoginFailReason, LoginListener};
use crate::rest_client::{HttpMethod, RestClient, RestClientOptions};
use crate::rest_error::HttpError;
use crate::type_model_provider::TypeModelProvider;
use crate::user_facade::UserFacade;

struct LoginFacade {
    async_login_state: AsyncLoginState,
    entity_client: Arc<EntityClient>,
    instance_mapper: Arc<InstanceMapper>,
    user_facade: Arc<Mutex<UserFacade>>,
    login_listener: Arc<dyn LoginListener>,
    rest_client: Arc<dyn RestClient>,
    type_model_provider: Arc<TypeModelProvider>,
    base_url: String,
}

pub enum SessionType {
    Login,
    Temporary,
    Persistent,
}

struct AsyncLoginState {
    state: String,
    credentials: Option<Credentials>,
}

struct ResumeSessionResultData {
    user: User,
    user_group_info: GroupInfo,
    session_id: IdTuple,
}

struct InitializedSession {
    user: User,
    access_token: String,
    user_group_info: GroupInfo,
}

enum ResumeSessionErrorReason {
    OfflineNotAvailableForFree
}

struct ResumeSectionSuccess {
    result_type: String,
    data: ResumeSessionResultData,
}

struct SessionData {
    user_id: Id,
    access_key: Option<GenericAesKey>,
}

struct ResumeSectionFailure {
    result_type: String,
    reason: ResumeSessionErrorReason,
}

enum ResumeSessionResult {
    Success(ResumeSectionSuccess),
    Failure(ResumeSectionFailure),
}

#[derive(PartialEq)]
pub enum AccountType {
    SYSTEM,
    FREE,
    STARTER,
    PAID,
    EXTERNAL,
}

impl AccountType {
    pub fn from(value: i64) -> AccountType {
        match value {
            0 => AccountType::SYSTEM,
            1 => AccountType::FREE,
            2 => AccountType::STARTER,
            3 => AccountType::PAID,
            4 => AccountType::EXTERNAL,
            _ => panic!("Invalid account type")
        }
    }
}

pub const GENERATED_ID_BYTES_LENGTH: usize = 9;

impl LoginFacade {
    pub fn new(
        entity_client: Arc<EntityClient>,
        instance_mapper: Arc<InstanceMapper>,
        user_facade: Arc<Mutex<UserFacade>>,
        login_listener: Arc<dyn LoginListener>,
        rest_client: Arc<dyn RestClient>,
        type_model_provider: Arc<TypeModelProvider>,
        base_url: &str,
    ) -> Self {
        LoginFacade {
            async_login_state: AsyncLoginState { state: String::from("idle"), credentials: None },
            entity_client,
            instance_mapper,
            user_facade,
            login_listener,
            rest_client,
            type_model_provider,
            base_url: base_url.to_string(),
        }
    }

    fn get_session_element_id(&self, access_token: &str) -> String {
        let bytes = match BASE64_URL_SAFE.decode(access_token) {
            Ok(bytes) => bytes,
            _ => panic!("Failed to parse session element id")
        };
        BASE64_URL_SAFE.encode(sha256(&bytes[GENERATED_ID_BYTES_LENGTH..]))
    }

    fn get_session_list_id(&self, access_token: &str) -> String {
        let bytes = match BASE64_URL_SAFE.decode(access_token) {
            Ok(bytes) => bytes,
            _ => panic!("Failed to parse session list id")
        };
        BASE64_URL_SAFE.encode(sha256(&bytes[0..GENERATED_ID_BYTES_LENGTH]))
    }

    fn get_session_id(&self, access_token: &str) -> IdTuple {
        IdTuple { list_id: self.get_session_list_id(access_token), element_id: self.get_session_element_id(access_token) }
    }

    async fn load_session_data(&self, access_token: &str) -> Result<SessionData, ApiCallError> {
        let raw_session = self.entity_client.load(&Session::type_ref(), &IdType::Tuple(self.get_session_id(access_token))).await?;
        let session = self.instance_mapper.parse_entity::<Session>(raw_session).map_err(|e| InternalSdkError { error_message: e.to_string() })?;
        let key = match session.accessKey {
            Some(key) => {
                match key {
                    key if key.len() == 16 => Some(Aes128(Aes128Key::from_bytes(key.as_slice()).map_err(|e| InternalSdkError { error_message: e.to_string() })?)),
                    key if key.len() == 32 => Some(Aes256(Aes256Key::from_bytes(key.as_slice()).map_err(|e| InternalSdkError { error_message: e.to_string() })?)),
                    _ => panic!("Invalid access key length")
                }
            }
            None => None
        };

        Ok(SessionData {
            access_key: key,
            user_id: session.user,
        })
    }

    async fn derive_user_passphrase_key(&self, kdf_type: KdfType, passphrase: &str, salt: [u8; 16]) -> GenericAesKey {
        match kdf_type {
            KdfType::Argon2id => {
                Aes256(generate_key_from_passphrase(passphrase, salt))
            }
            KdfType::Bcrypt => panic!("BCrypt not implemented")
        }
    }

    async fn delete_session(&self, access_token: &str, push_identifier: Option<&str>) -> Result<(), ApiCallError> {
        let type_ref = Session::type_ref();
        let type_model = self.type_model_provider.get_type_model(type_ref.app.as_str(), type_ref.type_.as_str())
            .ok_or_else(|| return ApiCallError::InternalSdkError { error_message: "Failed to find session model".to_string() })?;
        let session_id = self.get_session_id(access_token);

        let model_version: u32 = type_model.version.parse().map_err(|_| {
            ApiCallError::InternalSdkError { error_message: format!("Tried to parse invalid model_version {}", type_model.version) }
        })?;

        let mut url = format!("{}/rest/{}/{}/{}/{}", self.base_url, type_ref.app, type_ref.type_, session_id.list_id, session_id.element_id);

        if push_identifier.is_some() {
            url = format!("{}?pushIdentifier={}", url, push_identifier.unwrap())
        }

        let options = RestClientOptions {
            body: None,
            headers: HashMap::from([
                ("accessToken".to_owned(), access_token.to_string()),
                ("v".to_owned(), model_version.to_string())
            ]),
        };

        let response = self
            .rest_client
            .request_binary(url, HttpMethod::DELETE, options)
            .await?;

        let precondition = response.headers.get("precondition");
        match response.status {
            200..=299 => { Ok(()) }
            _ => return Err(ApiCallError::ServerResponseError { source: HttpError::from_http_response(response.status, precondition)? })
        }
    }

    async fn check_outdated_verifier(&self, user: &User, access_token: &str, user_passphrase_key: GenericAesKey) -> Result<(), ApiCallError> {
        let key_hashed_bytes = match user_passphrase_key {
            Aes256(key) => sha256(key.as_bytes()),
            Aes128(key) => sha256(key.as_bytes())
        };

        let base64_verifier = BASE64_STANDARD.encode(sha256(key_hashed_bytes.as_slice()));

        if !BASE64_STANDARD.encode(user.verifier.as_slice()).eq(base64_verifier.as_str()) {
            self.delete_session(access_token, None).await;
            self.reset_session();
            return Err(InternalSdkError { error_message: "Auth verifier has changed".to_string() });
        }

        Ok(())
    }

    async fn load_user_passphrase_key(&self, passphrase: &str, salt: [u8; 16]) -> Aes256Key {
        return match self.derive_user_passphrase_key(KdfType::Argon2id, passphrase, salt).await {
            Aes256(key) => key,
            _ => panic!("Invalid key size")
        };
    }

    async fn init_session(&self, user_id: &Id, access_token: &str, user_passphrase_key: GenericAesKey, session_type: SessionType) -> Result<InitializedSession, ApiCallError> {
        let mut user_facade = match self.user_facade.lock() {
            Ok(mut facade) => facade,
            _ => panic!("Failed to init session. UserFacade lock failed")
        };

        if user_facade.get_user().is_some() && user_facade.get_user().as_ref().unwrap()._id != user_id.to_string() {
            return Err(InternalSdkError { error_message: "Different user tried to login in existing other user's session".to_string() });
        }

        user_facade.set_access_token(access_token);

        let user = self.instance_mapper.parse_entity::<User>(self.entity_client.load(&User::type_ref(), &IdType::Single(user_id.to_string())).await?).map_err(|e| InternalSdkError { error_message: e.to_string() })?;
        match self.check_outdated_verifier(&user, access_token, user_passphrase_key).await {
            Err(e) => return Err(e),
            _ => ()
        };

        user_facade.set_user(user.clone());

        //FIXME: Unlock UserGroupKey
        let raw_group_info = self.entity_client.load(&GroupInfo::type_ref(), &IdType::Tuple(user.to_owned().userGroup.groupInfo)).await?;
        let user_group_info = match self.instance_mapper.parse_entity::<GroupInfo>(raw_group_info) {
            Ok(group_info) => group_info,
            Err(e) => return Err(InternalSdkError { error_message: e.to_string() })
        };

        self.login_listener.on_full_login_success(session_type);

        return Ok(InitializedSession {
            user,
            access_token: access_token.to_string(),
            user_group_info,
        });
    }

    async fn check_outdated_external_salt(&self, access_token: &str, session_data: &SessionData, external_user_salt: &[u8]) -> Result<(), ApiCallError> {
        let mut user_facade = match self.user_facade.lock() {
            Ok(mut facade) => facade,
            _ => panic!("Failed to check outdated salt. UserFacade lock failed")
        };

        user_facade.set_access_token(access_token);

        let raw_user = self.entity_client.load(&User::type_ref(), &IdType::Single(session_data.user_id.as_str().to_string())).await?;
        let user = match self.instance_mapper.parse_entity::<User>(raw_user) {
            Ok(user) => user,
            Err(e) => return Err(InternalSdkError { error_message: e.to_string() })
        };

        let latest_salt = match user.externalAuthInfo {
            Some(auth_info) => auth_info.latestSaltHash.ok_or(InternalSdkError { error_message: "Missing latestSaltHash".to_string() })?,
            None => return Err(InternalSdkError { error_message: "Missing authInfo and latestSaltHash".to_string() })
        };

        if !latest_salt.eq(&sha256(external_user_salt).as_slice()) {
            self.reset_session();
            return Err(InternalSdkError { error_message: "Salt changed, outdated link?".to_string() });
        }

        Ok(())
    }


    async fn finish_resume_session(&mut self, credentials: &Credentials, passphrase_salt: [u8; 16], external_user_key_deriver: Option<ExternalUserKeyDeriver>) -> Result<ResumeSessionResult, ApiCallError> {
        let session_id = self.get_session_id(credentials.access_token.as_str());
        let session_data = self.load_session_data(credentials.access_token.as_str()).await?;
        // Decode with base64
        let encrypted_password = credentials.encrypted_password.as_str().as_bytes();
        let passphrase = match session_data.access_key.as_ref() {
            Some(Aes128(key)) => aes_128_decrypt(&key, encrypted_password),
            Some(Aes256(key)) => aes_256_decrypt(&key, encrypted_password),
            None => return Err(InternalSdkError { error_message: "Missing user's acess_key".to_string() })
        }.map_err(|e| InternalSdkError { error_message: e.to_string() })?;

        let is_external_user = external_user_key_deriver.is_none();

        let user_passphrase_key = if is_external_user {
            self.check_outdated_external_salt(credentials.access_token.as_str(), &session_data, external_user_key_deriver.as_ref().unwrap().salt.as_slice()).await?;
            self.derive_user_passphrase_key(KdfType::Argon2id, String::from_utf8(passphrase).map_err(|e| InternalSdkError { error_message: e.to_string() })?.as_str(), external_user_key_deriver.as_ref().unwrap().salt.as_slice().try_into().unwrap()).await
        } else {
            GenericAesKey::Aes256(self.load_user_passphrase_key(String::from_utf8(passphrase).map_err(|e| InternalSdkError { error_message: e.to_string() })?.as_str(), passphrase_salt).await)
        };

        let (user, user_group_info) = match self.init_session(&session_data.user_id, credentials.access_token.as_str(), user_passphrase_key, SessionType::Persistent).await {
            Ok(session) => (session.user, session.user_group_info),
            Err(err) => return Err(err)
        };

        self.async_login_state.state = "idle".to_string();

        Ok(ResumeSessionResult::Success(ResumeSectionSuccess {
            result_type: "success".to_string(),
            data: ResumeSessionResultData {
                user,
                user_group_info,
                session_id,
            },
        }))
    }

    async fn async_resume_session(&mut self, credentials: Credentials, passphrase_salt: [u8; 16]) {
        if self.async_login_state.state == "running" {
            panic!("finishLoginResume run in parallel")
        }

        self.async_login_state.state = "running".to_string();

        match self.finish_resume_session(&credentials, passphrase_salt, None).await {
            Err(err) => {
                match err {
                    ApiCallError::ServerResponseError { source } => {
                        match source {
                            HttpError::SessionExpiredError | HttpError::NotAuthenticatedError => {
                                self.async_login_state.state = "idle".to_string();
                                self.login_listener.on_login_failure(LoginFailReason::SessionExpired)
                            }
                            err => {
                                self.async_login_state = AsyncLoginState {
                                    state: "failed".to_string(),
                                    credentials: Some(credentials),
                                };

                                match err {
                                    HttpError::ConnectionError => todo!("[WORKER] Send Error"),
                                    _ => ()
                                }

                                self.login_listener.on_login_failure(LoginFailReason::Error)
                            }
                        }
                    }
                    _ => ()
                }
            }
            _ => ()
        }
    }

    fn reset_session(&self) {
        match self.user_facade.lock() {
            Ok(mut user_facade) => user_facade.reset(),
            _ => panic!("Failed to reset session")
        }
    }

    pub async fn resume_session(&mut self, credentials: Credentials, external_user_key_deriver: Option<ExternalUserKeyDeriver>, database_key: Option<&[u8]>, time_range_days: Option<u64>) -> Result<ResumeSessionResult, ApiCallError> {
        let user_facade = self.user_facade.to_owned();
        let mut locked_user_facade = match user_facade.lock() {
            Ok(facade) => facade,
            Err(e) => return Err(InternalSdkError { error_message: "Failed to acquire UserFacade lock".to_string() })
        };

        if locked_user_facade.get_user().is_some() {
            return Err(InternalSdkError {
                error_message: format!(
                    "Trying to resume session for user {login_in} while already logged in for {logged_in}",
                    login_in = &credentials.user_id,
                    logged_in = &locked_user_facade.get_user().as_ref().unwrap()._id)
            });
        }

        if self.async_login_state.state == "idle" {
            return Err(InternalSdkError {
                error_message: format!(
                    "Trying to resume the session for user {user_id} while the asyncLoginState is ${state}",
                    user_id = &credentials.user_id,
                    state = self.async_login_state.state)
            });
        }

        locked_user_facade.set_access_token(&credentials.access_token);

        let session_id = self.get_session_id(credentials.access_token.as_str());
        let raw_user = match self.entity_client.load(&User::type_ref(), &IdType::Single(credentials.user_id.to_owned())).await {
            Ok(user) => user,
            Err(e) => {
                self.reset_session();
                return Err(e);
            }
        };

        let user: User = match self.instance_mapper.parse_entity::<User>(raw_user) {
            Ok(user) => user,
            Err(e) => {
                self.reset_session();
                return Err(InternalSdkError { error_message: e.to_string() });
            }
        };

        let passphrase_salt: [u8; 16] = match &user.salt {
            Some(salt) => salt.as_slice().clone().try_into().unwrap(),
            None => return Err(InternalSdkError { error_message: "Missing user's salt".to_string() })
        };

        if AccountType::from(user.accountType) != AccountType::PAID {
            return self.finish_resume_session(
                &credentials,
                passphrase_salt.try_into().unwrap(),
                external_user_key_deriver,
            ).await;
        }

        locked_user_facade.set_user(user.to_owned());
        let raw_group_info = match self.entity_client.load(&GroupInfo::type_ref(), &IdType::Tuple(user.clone().userGroup.groupInfo)).await {
            Ok(entity) => entity,
            Err(e) => {
                self.reset_session();
                return Err(e);
            }
        };
        let user_group_info = match self.instance_mapper.parse_entity::<GroupInfo>(raw_group_info) {
            Ok(group_info) => group_info,
            Err(e) => {
                self.reset_session();
                return Err(InternalSdkError { error_message: e.to_string() });
            }
        };

        self.async_resume_session(credentials, passphrase_salt).await;
        Ok(ResumeSessionResult::Success(ResumeSectionSuccess {
            result_type: "success".to_string(),
            data: ResumeSessionResultData {
                user,
                user_group_info,
                session_id,
            },
        }))
    }
}
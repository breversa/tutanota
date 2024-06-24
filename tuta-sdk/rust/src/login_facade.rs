use std::cmp::PartialEq;
use std::sync::{Arc, Mutex};

use crate::{ApiCallError, IdTuple};
use crate::ApiCallError::InternalSdkError;
use crate::cache_storage::{CacheInfo, CacheStorageLateInitializer};
use crate::entities::Entity;
use crate::entities::sys::{GroupInfo, GroupMembership, User};
use crate::entity_client::{EntityClient, IdType};
use crate::instance_mapper::InstanceMapper;
use crate::login_controller::{Credentials, ExternalUserKeyDeriver};
use crate::login_listener::{LoginFailReason, LoginListener};
use crate::rest_error::HttpError;
use crate::user_facade::UserFacade;

struct LoginFacade {
    async_login_state: AsyncLoginState,
    entity_client: Arc<EntityClient>,
    instance_mapper: Arc<InstanceMapper>,
    user_facade: Arc<Mutex<UserFacade>>,
    cache_initializer: Arc<CacheStorageLateInitializer>,
    login_listener: Arc<dyn LoginListener>,
}

struct AsyncLoginState {
    state: String,
    credentials: Option<Credentials>,
    cache_info: Option<CacheInfo>,
}


struct ResumeSessionResultData {
    user: User,
    user_group_info: GroupInfo,
    session_id: IdTuple,
}

struct ResumeSectionResult {
    result_type: String,
    data: ResumeSessionResultData,
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

impl LoginFacade {
    pub fn new(entity_client: Arc<EntityClient>, instance_mapper: Arc<InstanceMapper>, user_facade: Arc<Mutex<UserFacade>>, cache_initializer: Arc<CacheStorageLateInitializer>, login_listener: Arc<dyn LoginListener>) -> Self {
        LoginFacade {
            async_login_state: AsyncLoginState { state: String::from("idle"), credentials: None, cache_info: None },
            entity_client,
            instance_mapper,
            user_facade,
            cache_initializer,
            login_listener,
        }
    }

    fn get_session_id(&self, credentials: &Credentials) -> IdTuple {
        //TODO: Extract list_id and element_id
        IdTuple { list_id: "".to_string(), element_id: "".to_string() }
    }

    //FIXME: Implement finish resume session
    pub async fn finish_resume_session(&self, credentials: &Credentials, external_user_key_deriver: Option<ExternalUserKeyDeriver>, cache_info: &CacheInfo) -> Result<ResumeSectionResult, ApiCallError> {
        Ok(ResumeSectionResult {
            result_type: "success".to_string(),
            data: ResumeSessionResultData {
                user: User {
                    _format: 0,
                    _id: "".to_string(),
                    _ownerGroup: None,
                    _permissions: "".to_string(),
                    accountType: 0,
                    enabled: false,
                    kdfVersion: 0,
                    requirePasswordUpdate: false,
                    salt: None,
                    verifier: vec![],
                    alarmInfoList: None,
                    auth: None,
                    authenticatedDevices: vec![],
                    customer: None,
                    externalAuthInfo: None,
                    failedLogins: "".to_string(),
                    memberships: vec![],
                    phoneNumbers: vec![],
                    pushIdentifierList: None,
                    secondFactorAuthentications: "".to_string(),
                    successfulLogins: "".to_string(),
                    userGroup: GroupMembership {
                        _id: "".to_string(),
                        admin: false,
                        capability: None,
                        groupKeyVersion: 0,
                        groupType: None,
                        symEncGKey: vec![],
                        symKeyVersion: 0,
                        group: "".to_string(),
                        groupInfo: IdTuple { list_id: "".to_string(), element_id: "".to_string() },
                        groupMember: IdTuple { list_id: "".to_string(), element_id: "".to_string() },
                    },
                },
                user_group_info: GroupInfo {
                    _format: 0,
                    _id: IdTuple { list_id: "".to_string(), element_id: "".to_string() },
                    _listEncSessionKey: None,
                    _ownerEncSessionKey: None,
                    _ownerGroup: None,
                    _ownerKeyVersion: None,
                    _permissions: "".to_string(),
                    created: Default::default(),
                    deleted: None,
                    groupType: None,
                    mailAddress: None,
                    name: "".to_string(),
                    group: "".to_string(),
                    localAdmin: None,
                    mailAddressAliases: vec![],
                },
                session_id: IdTuple { list_id: "".to_string(), element_id: "".to_string() },
            },
        })
    }

    //FIXME: Add proper implementation with params
    pub async fn init_cache(&self, user_id: &str, database_key: Option<&[u8]>, time_range_days: Option<u64>, force_new_database: bool) -> CacheInfo {
        match database_key {
            Some(db_key) => self.cache_initializer.initialize(),
            _ => self.cache_initializer.initialize()
        }
    }

    pub async fn async_resume_session(&mut self, credentials: Credentials, cache_info: CacheInfo) {
        if self.async_login_state.state == "running" {
            panic!("finishLoginResume run in parallel")
        }

        self.async_login_state.state = "running".to_string();

        match self.finish_resume_session(&credentials, None, &cache_info).await {
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
                                    cache_info: Some(cache_info),
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
        self.cache_initializer.de_initialize();
        match self.user_facade.lock() {
            Ok(mut lock) => lock.reset(),
            _ => panic!("Failed to reset session")
        }
    }

    pub async fn resume_session(&mut self, credentials: Credentials, external_user_key_deriver: Option<ExternalUserKeyDeriver>, database_key: Option<&[u8]>, time_range_days: Option<u64>) -> Result<String, ApiCallError> {
        let user_facade = self.user_facade.clone();
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

        let cache_info = self.init_cache(&credentials.user_id.as_str(), database_key, time_range_days, false).await;

        let session_id = self.get_session_id(&credentials);

        if cache_info.is_persistent && !cache_info.is_new_offline_db {
            let raw_user = self.entity_client.load(&User::type_ref(), &IdType::Single(credentials.user_id.to_owned())).await?;
            let user: User = match self.instance_mapper.parse_entity::<User>(raw_user) {
                Ok(user) => user,
                Err(e) => {
                    self.reset_session();
                    return Err(InternalSdkError { error_message: e.to_string() });
                }
            };

            if AccountType::from(user.accountType) != AccountType::PAID {
                self.finish_resume_session(
                    &credentials,
                    external_user_key_deriver,
                    &cache_info,
                ).await?;

                return Ok(String::from(""));
            }

            locked_user_facade.set_user(user.to_owned());
            let user_group_info = match self.instance_mapper.parse_entity::<GroupInfo>(self.entity_client.load(&GroupInfo::type_ref(), &IdType::Tuple(user.clone().userGroup.groupInfo)).await?) {
                Ok(user_group) => user_group,
                Err(e) => {
                    self.reset_session();
                    return Err(InternalSdkError { error_message: e.to_string() });
                }
            };

            self.async_resume_session(credentials, cache_info).await;
            ResumeSectionResult {
                result_type: "success".to_string(),
                data: ResumeSessionResultData {
                    user,
                    user_group_info,
                    session_id,
                },
            }

            //TODO: Trigger full login async
        } else {
            self.finish_resume_session(&credentials, external_user_key_deriver, &cache_info).await?
        };

        Ok(String::from(""))
    }
}
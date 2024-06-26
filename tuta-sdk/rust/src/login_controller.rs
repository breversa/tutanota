use std::sync::Arc;

use crate::typed_entity_client::TypedEntityClient;

#[derive(uniffi::Object)]
pub struct LoginController {
    entity_client: Arc<TypedEntityClient>,
}

pub enum KdfType {
    Bcrypt,
    Argon2id,
}

pub struct ExternalUserKeyDeriver {
    kdf_type: KdfType,
    pub salt: Vec<u8>,
}

pub struct UnencryptedCredentials {
    credential_info: CredentialsInfo,
    access_token: String,
    database_key: Option<Vec<u8>>,
    encrypted_password: String,
}

pub struct Credentials {
    pub(crate) login: String,
    pub(crate) user_id: String,
    pub(crate) access_token: String,
    pub(crate) encrypted_password: String,
    pub(crate) credential_type: CredentialType,
}

pub enum CredentialType {
    Internal,
    External,
}

impl Credentials {
    pub fn from_unencrypted_credentials(unencrypted_credentials: UnencryptedCredentials) -> Credentials {
        Credentials {
            login: unencrypted_credentials.credential_info.login,
            user_id: unencrypted_credentials.credential_info.user_id,
            credential_type: unencrypted_credentials.credential_info.credential_type,
            access_token: unencrypted_credentials.access_token,
            encrypted_password: unencrypted_credentials.encrypted_password,
        }
    }
}

impl CredentialType {
    fn value(&self) -> &str {
        match *self {
            CredentialType::Internal => "internal",
            CredentialType::External => "external"
        }
    }
}

// FIXME: This struct comes from ipc generation, so when we implement the ipc for rust, we need to remove it
pub struct CredentialsInfo {
    login: String,
    user_id: String,
    credential_type: CredentialType,
}

impl LoginController {
    pub fn new(entity_client: Arc<TypedEntityClient>) -> Self {
        LoginController { entity_client }
    }

    pub fn resume_session(
        unencrypted_credentials: UnencryptedCredentials,
        external_user_key_deriver: Option<ExternalUserKeyDeriver>,
        offline_time_range_days: Option<i64>,
    ) {
        let credentials = Credentials::from_unencrypted_credentials(unencrypted_credentials);
    }
}


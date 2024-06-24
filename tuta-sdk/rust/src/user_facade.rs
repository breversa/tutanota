use std::borrow::ToOwned;
use std::sync::Arc;

use crate::ApiCallError;
use crate::entities::sys::User;
use crate::entity_client::IdType;
use crate::typed_entity_client::TypedEntityClient;

/// FIXME: for testing unencrypted entity downloading. Remove after everything works together.
#[derive(uniffi::Object)]
pub struct UserFacade {
    entity_client: Arc<TypedEntityClient>,
    user: Option<User>,
    access_token: Option<String>,
}

impl UserFacade {
    pub fn new(entity_client: Arc<TypedEntityClient>) -> Self {
        UserFacade { entity_client, user: None, access_token: None }
    }

    pub fn get_user(&self) -> &Option<User> {
        &self.user
    }

    pub fn set_access_token(&mut self, access_token: &str) {
        self.access_token = Some(access_token.to_string())
    }

    pub fn set_user(&mut self, user: User) {
        self.user = Some(user)
    }

    pub fn reset(&mut self) {
        self.user = None;
        self.access_token = None;
    }
}

#[uniffi::export]
impl UserFacade {
    /// Gets a user (an entity/instance of `User`) from the backend
    pub async fn load_user_by_id(&self, id: &str) -> Result<User, ApiCallError> {
        self.entity_client.load(&IdType::Single(id.to_owned())).await
    }
}
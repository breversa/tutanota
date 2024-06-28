use crate::login_facade::SessionType;

pub struct LoginListener {}
impl LoginListener {
    pub fn new() -> Self {
        LoginListener {}
    }

    pub fn on_login_failure(&self, reason: LoginFailReason) {}
    pub fn on_full_login_success(&self, session_type: SessionType) {}
}

pub enum LoginFailReason {
    SessionExpired,
    Error,
}
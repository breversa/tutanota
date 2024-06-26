use crate::login_facade::SessionType;

pub trait LoginListener: Send + Sync {
    fn on_login_failure(&self, reason: LoginFailReason);
    fn on_full_login_success(&self, session_type: SessionType);
}

pub enum LoginFailReason {
    SessionExpired,
    Error,
}
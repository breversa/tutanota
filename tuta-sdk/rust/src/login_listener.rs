pub trait LoginListener: Send + Sync {
    fn on_login_failure(&self, reason: LoginFailReason);
}

pub enum LoginFailReason {
    SessionExpired,
    Error,
}
pub struct CacheInfo {
    pub is_persistent: bool,
    pub is_new_offline_db: bool,
}

//FIXME: This should be fully implemented before releasing it
pub struct CacheStorageLateInitializer {}

impl CacheStorageLateInitializer {
    pub fn new() -> Self {
        CacheStorageLateInitializer {}
    }

    pub fn initialize(&self) -> CacheInfo {
        CacheInfo {
            is_persistent: true,
            is_new_offline_db: true,
        }
    }

    pub fn de_initialize(&self) {}
}
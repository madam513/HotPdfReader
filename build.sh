rm -rf ./src-tauri/target
rustup target add x86_64-apple-darwin
rustup target add aarch64-apple-darwin
npm run tauri build -- --target universal-apple-darwin
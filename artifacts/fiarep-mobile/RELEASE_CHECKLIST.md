# FIAREP Mobile Release Checklist

## Installation access isolation

### Automated preflight

- [x] The installation persona is stored in the app-local SQLite database.
- [x] The first persona selection is write-once.
- [x] Resident, Vendor, and Staff permissions do not overlap.
- [x] App startup restores the saved persona before routing.
- [x] Staff logout clears authentication and operational caches without deleting the installation persona.
- [x] Conflicting restored sessions are rejected.
- [x] Mobile TypeScript check passes.
- [x] Installation-persona policy tests pass.

### Signed-build requirements

Run this matrix using the signed build intended for release:

- iOS: TestFlight or App Store build with bundle identifier `com.fiarep.app`
- Android: Play internal, closed, open, or production build with package `com.tmstni.constructionpm`

Expo Go and browser storage are not substitutes for this check.

### iOS physical-device results

Device:

iOS version:

Build version:

Tester:

Date:

#### Resident

- [ ] Uninstall FIAREP.
- [ ] Install the signed build.
- [ ] Confirm the first launch shows exactly Resident, Vendor, and Staff.
- [ ] Select Resident.
- [ ] Force-close and reopen the app.
- [ ] Confirm the app opens only Resident access.
- [ ] Restart the device and reopen the app.
- [ ] Confirm the app still opens only Resident access.
- [ ] Uninstall and reinstall FIAREP.
- [ ] Confirm the first launch again shows exactly Resident, Vendor, and Staff.

#### Vendor

- [ ] Select Vendor after a clean reinstall.
- [ ] Force-close and reopen the app.
- [ ] Confirm the app opens only Vendor access.
- [ ] Restart the device and reopen the app.
- [ ] Confirm the app still opens only Vendor access.
- [ ] Uninstall and reinstall FIAREP.
- [ ] Confirm the first launch again shows exactly Resident, Vendor, and Staff.

#### Staff

- [ ] Select Staff after a clean reinstall.
- [ ] Sign in with an authorized staging Staff account.
- [ ] Force-close and reopen the app.
- [ ] Confirm the app restores only authorized Staff access.
- [ ] Log out.
- [ ] Confirm logout returns only to Staff access.
- [ ] Force-close and reopen the app.
- [ ] Confirm the app still opens only Staff access.
- [ ] Uninstall and reinstall FIAREP.
- [ ] Confirm the first launch again shows exactly Resident, Vendor, and Staff.

Result: **Awaiting physical iOS verification**

Notes:

### Android physical-device results

Device:

Android version:

Build version:

Tester:

Date:

#### Resident

- [ ] Uninstall FIAREP.
- [ ] Install the signed build.
- [ ] Confirm the first launch shows exactly Resident, Vendor, and Staff.
- [ ] Select Resident.
- [ ] Force-stop and reopen the app.
- [ ] Confirm the app opens only Resident access.
- [ ] Restart the device and reopen the app.
- [ ] Confirm the app still opens only Resident access.
- [ ] Uninstall and reinstall FIAREP.
- [ ] Confirm the first launch again shows exactly Resident, Vendor, and Staff.

#### Vendor

- [ ] Select Vendor after a clean reinstall.
- [ ] Force-stop and reopen the app.
- [ ] Confirm the app opens only Vendor access.
- [ ] Restart the device and reopen the app.
- [ ] Confirm the app still opens only Vendor access.
- [ ] Uninstall and reinstall FIAREP.
- [ ] Confirm the first launch again shows exactly Resident, Vendor, and Staff.

#### Staff

- [ ] Select Staff after a clean reinstall.
- [ ] Sign in with an authorized staging Staff account.
- [ ] Force-stop and reopen the app.
- [ ] Confirm the app restores only authorized Staff access.
- [ ] Log out.
- [ ] Confirm logout returns only to Staff access.
- [ ] Force-stop and reopen the app.
- [ ] Confirm the app still opens only Staff access.
- [ ] Uninstall and reinstall FIAREP.
- [ ] Confirm the first launch again shows exactly Resident, Vendor, and Staff.

Result: **Awaiting physical Android verification**

Notes:

## Release decision

- [ ] iOS physical-device matrix passed.
- [ ] Android physical-device matrix passed.
- [ ] Any failures are documented with platform, OS version, build version, selected persona, and observed route.

Do not mark installation access isolation complete until both signed-build matrices pass.
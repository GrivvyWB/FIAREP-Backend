# Staging phone push check

Run this check before a FIAREP.COM release to verify the complete path from the API to a real iOS or Android staging phone.

## Safety boundary

- Use a dedicated staging tenant and staging staff account. Never use production staff credentials or a production device.
- The API route returns `404` unless `FIAREP_ENABLE_STAGING_PUSH_SMOKE_TESTS=true` and the authenticated account belongs to `FIAREP_STAGING_TENANT_ID`.
- Store the staff name, staff code, and Expo token as Replit Secrets. Do not paste them into source code, command history, logs, or chat.
- Set the API URL and staging tenant ID as environment variables in the staging environment only.

## One-time setup

1. Install the FIAREP mobile staging build on one iOS or Android phone.
2. Sign in with a dedicated elevated staging staff account.
3. Allow notifications and copy the Expo push token into the `FIAREP_STAGING_EXPO_TOKEN` staging secret.
4. Configure:
   - Secret `FIAREP_STAGING_STAFF_NAME`
   - Secret `FIAREP_STAGING_STAFF_CODE`
   - Secret `FIAREP_STAGING_EXPO_TOKEN`
   - Environment variable `FIAREP_STAGING_API_URL`, including the API base path, for example `https://staging.example.com/api`
   - Environment variable `FIAREP_STAGING_TENANT_ID`
   - Environment variable `FIAREP_ENABLE_STAGING_PUSH_SMOKE_TESTS=true`
   - Optional environment variable `FIAREP_STAGING_STAFF_ROLE` when the account name is shared by multiple roles

The API environment and the shell running the script must receive the variables relevant to each side. The API needs the tenant ID and enable flag. The script needs the URL and staging account/device values.

## Release check

1. Lock the staging phone so the app is not open.
2. Run:

   ```sh
   pnpm --filter @workspace/scripts run smoke:push
   ```

3. Confirm the phone shows the uniquely timestamped `FIAREP.COM staging alert`.
4. Keep the script running. Expo recommends waiting about 15 minutes before checking final receipts, so the script allows 25 minutes by default.
5. Approve the release only when:
   - The phone displayed the matching alert.
   - The script exits successfully with status `delivered`.
   - The output includes the notification ID, Expo ticket ID, and completion time.

If the script reports `failed`, `rejected`, `request_failed`, or `receipt_timeout`, do not approve the release. An elevated staging user can inspect `/v1/push-deliveries?notificationId=...` for the same final delivery record.
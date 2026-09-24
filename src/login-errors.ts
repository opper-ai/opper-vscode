/** Proposed machine codes; unknown errors never imply that renewal restores entitlement. */
export function credentialError(status: number, body?: string): string | undefined {
	let code: unknown;
	try { const data = JSON.parse(body ?? '{}'); code = data.error?.code ?? data.detail; } catch { /* No response detail available. */ }
	if (code === 'credential_expired') return 'Opper credential expired. Run "Opper: Renew Sign-in".';
	if (code === 'membership_removed' || code === 'account_suspended') return 'Opper organization access is unavailable. Contact your administrator.';
	if (code === 'credential_revoked') return 'This Opper credential was revoked. Sign in again to recover a replacement; if access was removed, contact your administrator.';
	if (code === 'sso_required') return 'Sign in using your organization’s required SSO connection.';
	if (status === 401) return 'Opper rejected this credential. Check sign-in status; renew if expired. Revoked access may require your administrator.';
	return undefined;
}

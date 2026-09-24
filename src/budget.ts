import type { BudgetScope, OpperIdentity } from './api';

export interface BudgetRow { label: string; description?: string; detail?: string }

function money(cents: number | null | undefined, currency: string | undefined): string | undefined {
	if (currency !== 'usd' || typeof cents !== 'number' || !Number.isFinite(cents)) return undefined;
	return `USD ${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function period(scope: BudgetScope): string | undefined {
	const dates = [scope.period_start, scope.period_end].map(value => value ? new Date(value) : undefined);
	if (dates.some(date => !date || !Number.isFinite(date.getTime()))) return undefined;
	return `${dates[0]!.toISOString().slice(0, 10)} – ${dates[1]!.toISOString().slice(0, 10)} (UTC)`;
}

function scopeRows(scope: BudgetScope, name: 'Project' | 'Organization'): BudgetRow[] {
	const rows: BudgetRow[] = [{ label: `${name} spend`, description: money(scope.spent_cents, scope.currency) ?? 'Unavailable', detail: period(scope) }];
	if (scope.limit_cents === null) {
		rows.push({ label: `No ${name.toLowerCase()} limit`, detail: name === 'Project' ? 'Organization funding and limits still apply.' : 'Organization funding still applies.' });
	} else if (scope.limit_scope === name.toLowerCase() && typeof scope.limit_cents === 'number' && scope.limit_cents >= 0) {
		rows.push({ label: `${name} remaining`, description: money(scope.remaining_cents, scope.currency) ?? 'Unavailable', detail: `Limit: ${money(scope.limit_cents, scope.currency) ?? 'unavailable'}` });
	} else {
		rows.push({ label: `${name} limit unavailable` });
	}
	return rows;
}

/** Only explicitly authorized organization amounts may enter the view. */
export function budgetRows(me: OpperIdentity): BudgetRow[] {
	const rows: BudgetRow[] = [];
	if (me.blocked === true) {
		const reason = me.block_reason === 'project_spend_cap_hit' ? 'Project limit reached'
			: me.block_reason === 'org_spend_cap_hit' ? 'Organization limit reached'
			: me.block_reason === 'balance_exhausted' ? 'Organization out of credits' : 'Spending unavailable';
		rows.push({ label: '$(warning) Spending blocked', description: reason, detail: 'Contact your organization administrator.' });
	}
	if (me.project_spend) rows.push(...scopeRows(me.project_spend, 'Project'));
	else rows.push({ label: 'Project budget unavailable', detail: 'The server did not provide project budget details.' });
	if (me.visibility?.organization_finance === true) {
		const balance = money(me.balance?.balance_cents, me.balance?.currency);
		if (balance !== undefined) rows.push({ label: 'Organization credits', description: balance });
		if (me.spend) rows.push(...scopeRows(me.spend, 'Organization'));
	}
	return rows;
}

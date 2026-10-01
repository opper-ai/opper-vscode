const test = require('node:test');
const assert = require('node:assert/strict');
const { budgetRows } = require('../out/budget.js');
const scope = { currency: 'usd', spent_cents: 1234, limit_cents: 5000, remaining_cents: 3766, limit_scope: 'project', period_start:'2026-09-01T00:00:00Z',period_end:'2026-10-01T00:00:00Z' };
const text = me => JSON.stringify(budgetRows(me));
test('project budget shows server allowance and period, independently of org credits', () => {
 const result=text({project_spend:scope});
 assert.match(result,/USD 12.34/);assert.match(result,/USD 37.66/);assert.match(result,/USD 50.00/);assert.match(result,/2026-09-01/);
});
test('organization financial data requires explicit visibility, including legacy responses',()=>{
 for(const visibility of [undefined,{organization_finance:false}]) {
  const result=text({project_spend:scope,visibility,balance:{currency:'usd',balance_cents:987654},spend:{...scope,spent_cents:999999}});
  assert.doesNotMatch(result,/9,876|9,999|Organization credits|Organization spend/);
 }
 const result=text({visibility:{organization_finance:true},balance:{currency:'usd',balance_cents:987654},spend:{...scope,limit_scope:'organization'}});
 assert.match(result,/Organization credits/);assert.match(result,/USD 9,876.54/);assert.match(result,/Organization remaining/);
});
test('no direct cap is not unlimited or a zero allowance; missing cap is unavailable',()=>{
 const result=text({project_spend:{...scope,limit_cents:null,remaining_cents:null,limit_scope:null}});
 assert.match(result,/No project limit/);assert.match(result,/funding and limits still apply/);assert.doesNotMatch(result,/remaining|unlimited|USD 0.00/);
 assert.match(text({project_spend:{currency:'usd'}}),/Project limit unavailable/);
 assert.match(text({}),/Project budget unavailable/);
});
test('blocked reasons remain visible without financial permission, including a zero cap',()=>{
 for(const [block_reason,message] of [['project_spend_cap_hit','Project limit reached'],['org_spend_cap_hit','Organization limit reached'],['balance_exhausted','Organization out of credits']]) {
  const result=text({blocked:true,block_reason,project_spend:{...scope,limit_cents:0,remaining_cents:0}});
  assert.match(result,/Spending blocked/);assert.ok(result.includes(message));assert.match(result,/USD 0.00/);
 }
 assert.doesNotMatch(text({blocked:false,block_reason:'balance_exhausted'}),/Spending blocked/);
});
test('invalid amounts/currency/period are not invented or formatted as dollars',()=>{
 const result=text({project_spend:{...scope,currency:'eur',spent_cents:NaN,period_start:'bad'}});
 assert.doesNotMatch(result,/USD|NaN|bad/);assert.match(result,/Unavailable/);
});
const {allowanceSummary,budgetSummary}=require('../out/budget.js');
const {budgetHtml}=require('../out/budget-html.js');
test('allowance bar uses the project cap, handles zero and overage, and labels reset in UTC',()=>{
 const a=allowanceSummary({project_spend:scope});assert.equal(a.percent,24.68);assert.match(a.reset,/1 October 2026/);
 assert.equal(allowanceSummary({project_spend:{...scope,limit_cents:0}}).percent,undefined);
 const html=budgetHtml({project_spend:{...scope,spent_cents:6000}},'nonce');assert.match(html,/value="100"/);assert.match(html,/120% used/);
 assert.doesNotMatch(budgetHtml({project_spend:{...scope,limit_cents:null}},'nonce'),/<progress/);
});
test('budget HTML escapes project data and hides organization data without permission',()=>{
 const me={project:{name:'<script>alert(1)</script>'},project_spend:scope,balance:{currency:'usd',balance_cents:987654},spend:scope};
 const html=budgetHtml(me,'nonce');assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/9,876|Organization billing/);
 assert.match(budgetHtml({...me,visibility:{organization_finance:true}},'nonce'),/Organization billing/);
 assert.match(budgetSummary(me,new Date()),/USD 12.34 used of USD 50.00/);
});
test('personal and role allowance lead the panel and footer without exposing organization billing', () => {
 for (const limit_scope of ['member', 'role']) {
  const me = {organization:{name:'Opper'},project:{name:'Demo'},project_spend:scope,
   member_spend:{...scope,limit_scope,spent_cents:200,limit_cents:1000,remaining_cents:800},
   visibility:{organization_finance:false},balance:{currency:'usd',balance_cents:987654}};
  const a=allowanceSummary(me);assert.equal(a.total,'USD 10.00');assert.equal(a.percent,20);
  const html=budgetHtml(me,'nonce');assert.match(html,/Your allowance/);assert.match(html,/Project usage/);
  assert.match(html,/USD 8.00 remaining/);assert.doesNotMatch(html,/Organization billing|9,876/);
  assert.equal(html.includes('Allowance set by your role.'),limit_scope==='role');
  assert.match(budgetSummary(me,new Date()),/USD 2.00 used of USD 10.00/);
 }
});
test('personal no-cap, zero-cap and unavailable caps do not fall back to shared project allowance', () => {
 const me={project_spend:scope,member_spend:{...scope,limit_scope:null,limit_cents:null}};
 assert.equal(allowanceSummary(me).total,undefined);
 assert.match(allowanceSummary(me).note,/No personal allowance/);
 assert.doesNotMatch(budgetSummary(me,new Date()),/USD 50.00/);
 assert.match(allowanceSummary({...me,member_spend:{...scope,limit_scope:'member',limit_cents:0}}).note,/Personal allowance is zero/);
 assert.match(allowanceSummary({...me,member_spend:{...scope,limit_scope:'project'}}).note,/unavailable/);
 assert.match(budgetHtml({...me,blocked:true,block_reason:'member_spend_cap_hit'},'nonce'),/Your allowance reached/);
});

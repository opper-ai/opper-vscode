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

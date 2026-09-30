import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import { OpperClient, OpperApiError, type OpperIdentity } from './api';
import type { Auth } from './auth';
import { budgetSummary } from './budget';
import { budgetHtml } from './budget-html';

export class BudgetView implements vscode.Disposable {
 private panel?: vscode.WebviewPanel;
 private snapshot?: OpperIdentity;
 private updated?: Date;
 private error?: string;
 private epoch = 0;
 private request?: AbortController;
 private pending?: Promise<void>;
 private readonly subscriptions: vscode.Disposable[];
 constructor(private auth: Auth, private getBaseUrl: () => string, private changed: (summary?: string) => void) {
  this.subscriptions = [auth.onDidChange(()=>this.clear()), vscode.workspace.onDidChangeConfiguration(e=>{if(e.affectsConfiguration('opper.baseUrl'))this.clear();})];
 }
 private clear(): void { this.epoch++; this.request?.abort(); this.pending=undefined; this.snapshot=undefined; this.updated=undefined; this.error=undefined; this.changed(); this.panel?.dispose(); this.panel=undefined; }
 private render(): void { if(this.panel)this.panel.webview.html=budgetHtml(this.snapshot,randomBytes(16).toString('hex'),this.updated,this.error); }
 async show(): Promise<void> {
  if(this.panel)this.panel.reveal();
  else {
   const panel = this.panel=vscode.window.createWebviewPanel('opper.budget','Opper budget',vscode.ViewColumn.Beside,{enableScripts:true,localResourceRoots:[]});
   panel.onDidDispose(()=>{if(this.panel===panel)this.panel=undefined;});
   panel.webview.onDidReceiveMessage(message=>{if(message?.type==='refresh')void this.refresh(true);});
  }
  this.render(); await this.refresh(true);
 }
 async refresh(force=false): Promise<void> {
  if(this.pending)return this.pending;
  if(!force&&this.updated&&Date.now()-this.updated.getTime()<60000)return;
  const epoch=this.epoch;
  const job=this.load(epoch);this.pending=job;
  try {await job;}finally{if(this.pending===job)this.pending=undefined;}
 }
 private async load(epoch: number): Promise<void> {
  const origin=this.getBaseUrl();const controller=this.request=new AbortController();
  try {
   const resolved=await this.auth.resolve();
   if(epoch!==this.epoch)return;
   if(!resolved){this.snapshot=undefined;this.updated=undefined;this.error='Sign in with Opper to see your project allowance.';this.changed();this.render();return;}
   const me=await new OpperClient(origin,resolved.key).getMe(AbortSignal.any([controller.signal,AbortSignal.timeout(15000)]));
   if(epoch!==this.epoch||origin!==this.getBaseUrl()||(await this.auth.resolve())?.key!==resolved.key)return;
   if(epoch!==this.epoch)return;
   this.snapshot=me;this.updated=new Date();this.error=undefined;this.changed(budgetSummary(me,this.updated));this.render();
  }catch(error){
   if(epoch!==this.epoch||controller.signal.aborted)return;
   this.snapshot=undefined;this.updated=undefined;
   this.error=error instanceof OpperApiError&&error.status===401 ? 'Your sign-in needs attention. Run Opper: Sign In or Renew Sign-in.' : error instanceof OpperApiError&&error.status===402 ? 'Spending is blocked. Budget details are unavailable; contact your administrator.' : 'Could not load your budget. Check latest usage to try again.';
   this.changed(this.error);this.render();
  }
 }
 dispose(): void {this.clear();for(const s of this.subscriptions)s.dispose();}
}

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const modalSource = fs.readFileSync(new URL('./src/components/modals/LaunchPlaybookModal.tsx', import.meta.url), 'utf8');
const welcomeTourSource = fs.readFileSync(new URL('./src/components/modals/WelcomeTourModal.tsx', import.meta.url), 'utf8');
const stepDockSource = fs.readFileSync(new URL('./src/components/drawers/StepDock.tsx', import.meta.url), 'utf8');
const sidebarSource = fs.readFileSync(new URL('./src/components/navigation/AppSidebar.tsx', import.meta.url), 'utf8');
const appSource = fs.readFileSync(new URL('./src/App.tsx', import.meta.url), 'utf8');
const headerSource = fs.readFileSync(new URL('./src/components/toolbar/CanvasHeader.tsx', import.meta.url), 'utf8');

test('LaunchPlaybookModal exports component with 5 milestones and accessible dialog', () => {
  assert.ok(modalSource.includes('export const LaunchPlaybookModal'));
  assert.ok(modalSource.includes('ModalDialog labelledBy="launch-playbook-title"'));
  
  const milestones = [
    '1. Connect Shopify Store',
    '2. Choose Funnel Blueprint',
    '3. Configure Core Offer',
    '4. Pre-Flight Conversion Audit',
    '5. Publish Live Funnel'
  ];
  for (const m of milestones) {
    assert.ok(modalSource.includes(m), `LaunchPlaybookModal missing milestone: ${m}`);
  }
});

test('LaunchPlaybookModal and AppSidebar contain no em dashes or spaced en dashes', () => {
  assert.ok(!modalSource.includes('—'), 'LaunchPlaybookModal contains em dash');
  assert.ok(!modalSource.includes(' – '), 'LaunchPlaybookModal contains spaced en dash');
  assert.ok(!sidebarSource.includes('—'), 'AppSidebar contains em dash');
  assert.ok(!sidebarSource.includes(' – '), 'AppSidebar contains spaced en dash');
});

test('AppSidebar exposes onOpenLaunchPlaybook trigger with accessible badge', () => {
  assert.ok(sidebarSource.includes('onOpenLaunchPlaybook?: () => void;'));
  assert.ok(sidebarSource.includes('launchCompleted?: number;'));
  assert.ok(sidebarSource.includes('launchTotal?: number;'));
  assert.ok(sidebarSource.includes('Launch playbook: ${launchCompleted} of ${launchTotal} completed'));
  assert.ok(sidebarSource.includes('Playbook'));
});

test('App.tsx computes 5 deterministic milestones and lazy mounts LaunchPlaybookModal', () => {
  assert.ok(appSource.includes('const LaunchPlaybookModal = lazy('));
  assert.ok(appSource.includes('const [showLaunchPlaybook, setShowLaunchPlaybook] = useState(false);'));
  assert.ok(appSource.includes('onOpenLaunchPlaybook={() => setShowLaunchPlaybook(true)}'));
  assert.ok(appSource.includes('<LaunchPlaybookModal'));
  assert.ok(appSource.includes('isStoreConnected={isStoreConnected}'));
  assert.ok(appSource.includes('hasBlueprint={hasBlueprint}'));
  assert.ok(appSource.includes('hasOffer={hasOffer}'));
  assert.ok(appSource.includes('isAuditPassed={isAuditPassed}'));
  assert.ok(appSource.includes('isPublished={isPublished}'));
});

test('CanvasHeader remains free of dead checklist code', () => {
  for (const s of ['showChecklist', 'Launch Readiness', 'isOfferDone', 'isStoreDone', 'isPublishDone']) {
    assert.ok(!headerSource.includes(s), `CanvasHeader still contains ${s}`);
  }
});

test('WelcomeTourModal provides a 4-step interactive walkthrough with Skip Tour and no em dashes', () => {
  assert.ok(welcomeTourSource.includes('export const WelcomeTourModal'));
  assert.ok(welcomeTourSource.includes('ModalDialog labelledBy="welcome-tour-title"'));
  assert.ok(welcomeTourSource.includes("export const WELCOME_TOUR_STORAGE_KEY = 'jourvance_welcome_tour_seen'"));
  assert.ok(welcomeTourSource.includes('Skip Tour'));
  assert.ok(welcomeTourSource.includes('Start with a Turnkey Blueprint or Draft with AI'));
  assert.ok(welcomeTourSource.includes('Edit Your Page & Connect Checkout or Calendar Links'));
  assert.ok(welcomeTourSource.includes('Simulate as Lead or Buyer & Share Client Pitch Links'));
  assert.ok(welcomeTourSource.includes('Run Pre-Flight Checks & Publish in One Click'));
  assert.ok(!welcomeTourSource.includes('—'), 'WelcomeTourModal contains em dash');
  assert.ok(!welcomeTourSource.includes(' – '), 'WelcomeTourModal contains spaced en dash');
});

test('StepDock unselected state includes Quick-start guide and 60s tour trigger', () => {
  assert.ok(stepDockSource.includes('aria-label="Quick-start guide"'));
  assert.ok(stepDockSource.includes('Quick-Start & New Features'));
  assert.ok(stepDockSource.includes('Take 60s Tour'));
  assert.ok(stepDockSource.includes('1. Pick a Business Blueprint'));
  assert.ok(stepDockSource.includes('2. Edit Landing Page & Offer'));
  assert.ok(stepDockSource.includes('3. Connect Store or Booking Link'));
  assert.ok(stepDockSource.includes('4. Simulate Lead vs. Buyer Flow'));
  assert.ok(!stepDockSource.includes('—'), 'StepDock contains em dash');
  assert.ok(!stepDockSource.includes(' – '), 'StepDock contains spaced en dash');
});

test('LaunchPlaybookModal and App.tsx count Shopify, WooCommerce, or a direct checkout/booking link for Milestone 1', () => {
  assert.ok(modalSource.includes('1. Connect Shopify Store, WooCommerce, or Booking Link'));
  assert.ok(modalSource.includes('Replay 60s Tour'));
  assert.ok(appSource.includes('currentWorkspace?.woocommerceConfig?.status === \'connected\''));
  assert.ok(appSource.includes('hasDirectCheckoutLink'));
  assert.ok(appSource.includes('<WelcomeTourModal'));
});

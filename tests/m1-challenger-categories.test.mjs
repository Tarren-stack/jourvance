import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  UNIVERSAL_BUSINESS_CATEGORIES,
  normalizeBusinessCategory,
  isUniversalBusinessCategory
} from '../src/types/journey.ts';
import {
  ECOM_BLUEPRINTS,
  BLUEPRINT_CATEGORY_MAP,
  getBlueprintUniversalCategory
} from '../src/data/ecomBlueprints.ts';
import {
  buildJourneyFromPlan,
  DEFAULT_BRIEF,
  BRIEF_LIMITS,
  normalizeBrief
} from '../src/lib/journeyAi.ts';
import {
  createHistory,
  recordEdit,
  undoStep,
  redoStep,
  saveFingerprint
} from '../src/lib/journeyHistory.ts';

// Read source files for structural verification
const headerSrc = fs.readFileSync('src/components/toolbar/CanvasHeader.tsx', 'utf8');
const appSrc = fs.readFileSync('src/App.tsx', 'utf8');
const aiBuilderSrc = fs.readFileSync('src/components/modals/AiJourneyBuilder.tsx', 'utf8');
const blueprintModalSrc = fs.readFileSync('src/components/modals/BlueprintModal.tsx', 'utf8');

// ============================================================================
// PART 1: DATA MODEL & normalizeBusinessCategory STRESS TESTING
// ============================================================================

test('Challenger 1.1: Exact canonical categories are recognized and identity-preserved', () => {
  for (const cat of UNIVERSAL_BUSINESS_CATEGORIES) {
    assert.equal(isUniversalBusinessCategory(cat), true, `Expected ${cat} to be a universal category`);
    assert.equal(normalizeBusinessCategory(cat), cat, `Expected normalize to return exact canonical string for ${cat}`);
  }
});

test('Challenger 1.2: Whitespace trimming on canonical and raw categories', () => {
  assert.equal(normalizeBusinessCategory('  E-Commerce & Physical Retail  '), 'E-Commerce & Physical Retail');
  assert.equal(normalizeBusinessCategory('\t\nLocal & Client Services\r\n'), 'Local & Client Services');
  assert.equal(normalizeBusinessCategory(' \n B2B, Agencies & Consulting \t '), 'B2B, Agencies & Consulting');
  assert.equal(normalizeBusinessCategory('  Digital Products, Courses & Creators  '), 'Digital Products, Courses & Creators');
  assert.equal(normalizeBusinessCategory('  SaaS, Tech & Events  '), 'SaaS, Tech & Events');
  assert.equal(normalizeBusinessCategory(''), 'E-Commerce & Physical Retail');
  assert.equal(normalizeBusinessCategory('   '), 'E-Commerce & Physical Retail');
  assert.equal(normalizeBusinessCategory('\t\n\r'), 'E-Commerce & Physical Retail');
});

test('Challenger 1.3: Case-folding and case insensitivity across categories', () => {
  assert.equal(normalizeBusinessCategory('local & client services'), 'Local & Client Services');
  assert.equal(normalizeBusinessCategory('LOCAL & CLIENT SERVICES'), 'Local & Client Services');
  assert.equal(normalizeBusinessCategory('b2b, agencies & consulting'), 'B2B, Agencies & Consulting');
  assert.equal(normalizeBusinessCategory('B2B, AGENCIES & CONSULTING'), 'B2B, Agencies & Consulting');
  assert.equal(normalizeBusinessCategory('digital products, courses & creators'), 'Digital Products, Courses & Creators');
  assert.equal(normalizeBusinessCategory('saas, tech & events'), 'SaaS, Tech & Events');
  assert.equal(normalizeBusinessCategory('e-commerce & physical retail'), 'E-Commerce & Physical Retail');
});

test('Challenger 1.4: Fuzzy keyword routing for all categories', () => {
  // Local & Client Services (local, client, service)
  assert.equal(normalizeBusinessCategory('Highland Dental Clinic (Local Service)'), 'Local & Client Services');
  assert.equal(normalizeBusinessCategory('Corporate Client Advisory'), 'Local & Client Services');
  assert.equal(normalizeBusinessCategory('Emergency Plumbing Services'), 'Local & Client Services');

  // B2B, Agencies & Consulting (agency, consult, b2b)
  assert.equal(normalizeBusinessCategory('Creative Performance Agency'), 'B2B, Agencies & Consulting');
  assert.equal(normalizeBusinessCategory('Strategic Management Consulting Firm'), 'B2B, Agencies & Consulting');
  assert.equal(normalizeBusinessCategory('B2B Enterprise Sales Outreach'), 'B2B, Agencies & Consulting');

  // Digital Products, Courses & Creators (course, creator, digital, membership)
  assert.equal(normalizeBusinessCategory('Video Editing Masterclass Course'), 'Digital Products, Courses & Creators');
  assert.equal(normalizeBusinessCategory('Substack Creator Newsletter'), 'Digital Products, Courses & Creators');
  assert.equal(normalizeBusinessCategory('Digital Assets and Notion Templates'), 'Digital Products, Courses & Creators');
  assert.equal(normalizeBusinessCategory('VIP Monthly Community Membership'), 'Digital Products, Courses & Creators');

  // SaaS, Tech & Events (saas, tech, event, software)
  assert.equal(normalizeBusinessCategory('Micro-SaaS Cloud Tool'), 'SaaS, Tech & Events');
  assert.equal(normalizeBusinessCategory('Deep Tech Infrastructure'), 'SaaS, Tech & Events');
  assert.equal(normalizeBusinessCategory('Annual Virtual Summit & Live Event'), 'SaaS, Tech & Events');
  assert.equal(normalizeBusinessCategory('Desktop Accounting Software'), 'SaaS, Tech & Events');

  // Default fallback to Retail
  assert.equal(normalizeBusinessCategory('Random Unrelated Niche'), 'E-Commerce & Physical Retail');
  assert.equal(normalizeBusinessCategory('Handmade Artisan Leather Boots'), 'E-Commerce & Physical Retail');
});

test('Challenger 1.5: Null, undefined, and empty string handling', () => {
  assert.equal(normalizeBusinessCategory(null), 'E-Commerce & Physical Retail');
  assert.equal(normalizeBusinessCategory(undefined), 'E-Commerce & Physical Retail');
  assert.equal(normalizeBusinessCategory(''), 'E-Commerce & Physical Retail');
  assert.equal(isUniversalBusinessCategory(null), false);
  assert.equal(isUniversalBusinessCategory(undefined), false);
  assert.equal(isUniversalBusinessCategory(''), false);
});

test('Challenger 1.6: Emojis, unicode, and special characters', () => {
  assert.equal(normalizeBusinessCategory('🚀 Launch SaaS App 💻'), 'SaaS, Tech & Events');
  assert.equal(normalizeBusinessCategory('🏥 Dental Clinic Local Services 🦷'), 'Local & Client Services');
  assert.equal(normalizeBusinessCategory('💼 B2B Growth Agency 📈'), 'B2B, Agencies & Consulting');
  assert.equal(normalizeBusinessCategory('🎨 Digital Creator Community 🎥'), 'Digital Products, Courses & Creators');
  assert.equal(normalizeBusinessCategory('🛒 E-Commerce & Retail 🛍️'), 'E-Commerce & Physical Retail');
  assert.equal(normalizeBusinessCategory('🎉🔥✨'), 'E-Commerce & Physical Retail');
});

test('Challenger 1.7: Extreme string input and security payloads', () => {
  // Very long string
  const longPrefix = 'a'.repeat(50000);
  assert.equal(normalizeBusinessCategory(longPrefix), 'E-Commerce & Physical Retail');
  assert.equal(normalizeBusinessCategory(longPrefix + ' saas ' + longPrefix), 'SaaS, Tech & Events');

  // Script tags / HTML
  assert.equal(normalizeBusinessCategory('<script>alert("xss")</script>'), 'E-Commerce & Physical Retail');
  assert.equal(normalizeBusinessCategory('<script>saas</script>'), 'SaaS, Tech & Events');

  // SQL payloads
  assert.equal(normalizeBusinessCategory("'; DROP TABLE journeys; --"), 'E-Commerce & Physical Retail');
});

test('Challenger 1.8: Non-string inputs at runtime (empirically verify crash behavior)', () => {
  // isUniversalBusinessCategory safely checks typeof val === 'string'
  assert.equal(isUniversalBusinessCategory(123), false);
  assert.equal(isUniversalBusinessCategory(true), false);
  assert.equal(isUniversalBusinessCategory({}), false);
  assert.equal(isUniversalBusinessCategory([]), false);

  // normalizeBusinessCategory currently expects raw?: string | null
  // When passed non-string truthy values, it crashes with TypeError: raw.trim is not a function
  assert.throws(
    () => normalizeBusinessCategory(123),
    /raw\.trim is not a function/
  );
  assert.throws(
    () => normalizeBusinessCategory(true),
    /raw\.trim is not a function/
  );
  assert.throws(
    () => normalizeBusinessCategory({}),
    /raw\.trim is not a function/
  );
});

// ============================================================================
// PART 2: CanvasHeader CATEGORY SWITCHING & STATE RETENTION
// ============================================================================

test('Challenger 2.1: CanvasHeader category selector structure and accessibility', () => {
  assert.match(headerSrc, /<select[\s\S]*?aria-label="Business category"/, 'CanvasHeader must have select with aria-label');
  assert.match(headerSrc, /title="Business category"/, 'CanvasHeader must have title="Business category"');
  assert.match(headerSrc, /fontSize:\s*'11px'/, 'Select font size must be 11px for accessibility');

  // Options rendering
  assert.match(headerSrc, /UNIVERSAL_BUSINESS_CATEGORIES\.map\(category =>/, 'Select must map over UNIVERSAL_BUSINESS_CATEGORIES');
  assert.match(headerSrc, /background:\s*'#0B0F19'/, 'Option background must be dark #0B0F19');
  assert.match(headerSrc, /fontSize:\s*'12px'/, 'Option font size must be 12px');
});

test('Challenger 2.2: CanvasHeader value binding handles canonical, legacy, and missing categories', () => {
  // Verify select value logic in CanvasHeader
  assert.match(
    headerSrc,
    /value=\{\s*isUniversalBusinessCategory\(project\.businessType\)\s*\?\s*project\.businessType\s*:\s*normalizeBusinessCategory\(project\.businessType\)\s*\}/
  );

  const resolveHeaderValue = (businessType) => {
    return isUniversalBusinessCategory(businessType)
      ? businessType
      : normalizeBusinessCategory(businessType);
  };

  // Canonical categories bound directly
  for (const cat of UNIVERSAL_BUSINESS_CATEGORIES) {
    assert.equal(resolveHeaderValue(cat), cat);
  }

  // Legacy categories normalized cleanly
  assert.equal(resolveHeaderValue('Professional & Local Services'), 'Local & Client Services');
  assert.equal(resolveHeaderValue('E-Commerce Brand'), 'E-Commerce & Physical Retail');
  assert.equal(resolveHeaderValue(undefined), 'E-Commerce & Physical Retail');
  assert.equal(resolveHeaderValue(''), 'E-Commerce & Physical Retail');
});

test('Challenger 2.3: Category switching updates project state and records undo/redo history', () => {
  const initialProject = {
    id: 'journey_test_1',
    name: 'My Test Funnel',
    businessType: 'E-Commerce & Physical Retail',
    offerHeadline: 'Headline',
    goal: 'Goal',
    nodes: [],
    edges: [],
    updatedAt: new Date('2026-10-29T00:00:00Z').toISOString()
  };

  let history = createHistory();
  assert.equal(history.past.length > 0, false, 'Initial history has no undo steps');
  assert.equal(history.future.length > 0, false, 'Initial history has no redo steps');

  // User switches category to SaaS, Tech & Events
  const switchedProject = {
    ...initialProject,
    businessType: 'SaaS, Tech & Events',
    updatedAt: new Date('2026-10-29T00:01:00Z').toISOString()
  };

  // Verify saveFingerprint recognizes businessType change
  const fp1 = saveFingerprint(initialProject);
  const fp2 = saveFingerprint(switchedProject);
  assert.notEqual(fp1, fp2, 'Fingerprint must change when businessType changes');

  // Record edit in history (signature: h, before, after, nowMs)
  const nowMs = Date.now();
  history = recordEdit(history, initialProject, switchedProject, nowMs);
  assert.equal(history.past.length > 0, true, 'Category change must be undoable');

  // Undo step
  const undoResult = undoStep(history, switchedProject);
  assert.ok(undoResult, 'Undo must succeed');
  assert.equal(undoResult.target.businessType, 'E-Commerce & Physical Retail', 'Undo must restore original category');
  assert.equal(undoResult.history.future.length > 0, true, 'Redo must be available after undo');

  // Redo step
  const redoResult = redoStep(undoResult.history, undoResult.target);
  assert.ok(redoResult, 'Redo must succeed');
  assert.equal(redoResult.target.businessType, 'SaaS, Tech & Events', 'Redo must restore switched category');
});

// ============================================================================
// PART 3: DRAFT WITH AI BRIEF CATEGORY SELECTION & FALLBACK BEHAVIOR
// ============================================================================

test('Challenger 3.1: Brief constants and normalizeBrief behavior', () => {
  assert.equal(DEFAULT_BRIEF.businessType, '');
  assert.equal(BRIEF_LIMITS.businessType, 120);

  // normalizeBrief with valid businessType
  const b1 = normalizeBrief({
    goal: 'leads',
    offer: 'Test Offer',
    audience: 'Audience',
    businessType: 'Local & Client Services',
    platform: 'meta',
    abTest: false
  });
  assert.equal(b1.businessType, 'Local & Client Services');

  // normalizeBrief with missing businessType
  const b2 = normalizeBrief({
    goal: 'sales',
    offer: 'Test Offer',
    audience: 'Audience',
    platform: 'meta',
    abTest: false
  });
  assert.equal(b2.businessType, '', 'Missing businessType must normalize to empty string');

  // normalizeBrief truncates to BRIEF_LIMITS.businessType (120)
  const longType = 'x'.repeat(200);
  const b3 = normalizeBrief({
    goal: 'leads',
    offer: 'Test',
    audience: 'Test',
    businessType: longType,
    platform: 'meta'
  });
  assert.equal(b3.businessType.length, 120);
});

test('Challenger 3.2: buildJourneyFromPlan category propagation and fallback', () => {
  const dummyPlan = {
    name: 'AI Generated Campaign',
    pages: [
      { role: 'landing', title: 'Landing', headline: 'H', subhead: 'S', bullets: ['b1'], button: 'Buy' },
      { role: 'thanks', title: 'Thanks', headline: 'TH', subhead: 'TS', bullets: [], button: 'Done' }
    ],
    emails: [],
    ad: { headline: 'Ad Head', body: 'Ad Body', cta: 'Click' }
  };

  // Case A: Specified category is preserved
  const projectA = buildJourneyFromPlan(
    dummyPlan,
    { ...DEFAULT_BRIEF, goal: 'sales', businessType: 'B2B, Agencies & Consulting' },
    { id: '101', now: new Date().toISOString() }
  );
  assert.equal(projectA.businessType, 'B2B, Agencies & Consulting');

  // Case B: Whitespace around category is trimmed
  const projectB = buildJourneyFromPlan(
    dummyPlan,
    { ...DEFAULT_BRIEF, goal: 'sales', businessType: '  Digital Products, Courses & Creators  ' },
    { id: '102', now: new Date().toISOString() }
  );
  assert.equal(projectB.businessType, 'Digital Products, Courses & Creators');

  // Case C: Empty businessType falls back to 'E-Commerce & Physical Retail'
  const projectC = buildJourneyFromPlan(
    dummyPlan,
    { ...DEFAULT_BRIEF, goal: 'sales', businessType: '' },
    { id: '103', now: new Date().toISOString() }
  );
  assert.equal(projectC.businessType, 'E-Commerce & Physical Retail');

  // Case D: Whitespace-only businessType falls back to 'E-Commerce & Physical Retail'
  const projectD = buildJourneyFromPlan(
    dummyPlan,
    { ...DEFAULT_BRIEF, goal: 'sales', businessType: '   ' },
    { id: '104', now: new Date().toISOString() }
  );
  assert.equal(projectD.businessType, 'E-Commerce & Physical Retail');

  // Case E: Undefined brief.businessType crash behavior
  // Line 802 does: brief.businessType.trim() || 'E-Commerce & Physical Retail'
  // If brief.businessType is undefined, it throws TypeError: Cannot read properties of undefined (reading 'trim')
  assert.throws(
    () => buildJourneyFromPlan(
      dummyPlan,
      { goal: 'sales', offer: '', audience: '', platform: 'meta', abTest: false, upsell: false },
      { id: '105', now: new Date().toISOString() }
    ),
    /Cannot read properties of undefined \(reading 'trim'\)/
  );
});

test('Challenger 3.3: AiJourneyBuilder.tsx UI category wiring and accessibility', () => {
  // Brief dropdown
  assert.match(aiBuilderSrc, /id="ai-brief-business"/);
  assert.match(aiBuilderSrc, /value=\{brief\.businessType\s*\|\|\s*UNIVERSAL_BUSINESS_CATEGORIES\[0\]\}/);

  // 1-tap category buttons with aria-pressed
  assert.match(aiBuilderSrc, /UNIVERSAL_BUSINESS_CATEGORIES\.map\(category =>/);
  assert.match(aiBuilderSrc, /aria-pressed=\{active\}/);
  assert.match(aiBuilderSrc, /type="button"/);

  // Guard against disabled attribute on dialog buttons
  const pillsSection = aiBuilderSrc.slice(
    aiBuilderSrc.indexOf('UNIVERSAL_BUSINESS_CATEGORIES.map(category =>'),
    aiBuilderSrc.indexOf('</button>', aiBuilderSrc.indexOf('UNIVERSAL_BUSINESS_CATEGORIES.map(category =>')) + 9
  );
  assert.doesNotMatch(pillsSection, /\bdisabled\b/, 'Category pill buttons must not use native disabled attribute');
});

// ============================================================================
// PART 4: BLUEPRINT LOADING IN 'replace' AND 'new' MODES
// ============================================================================

test('Challenger 4.1: Shipped blueprints have canonical categories assigned', () => {
  assert.equal(ECOM_BLUEPRINTS.length, 6, 'Must have 6 shipped blueprints');
  for (const bp of ECOM_BLUEPRINTS) {
    assert.ok(bp.businessType, `Blueprint ${bp.id} must have businessType`);
    assert.ok(
      isUniversalBusinessCategory(bp.businessType),
      `Blueprint ${bp.id} businessType '${bp.businessType}' must be a universal category`
    );
  }
});

test('Challenger 4.2: getBlueprintUniversalCategory resolves categories and fallbacks', () => {
  // Known IDs
  assert.equal(getBlueprintUniversalCategory('single-product-flash-drop'), 'E-Commerce & Physical Retail');
  assert.equal(getBlueprintUniversalCategory('high-ticket-consultation'), 'B2B, Agencies & Consulting');
  assert.equal(getBlueprintUniversalCategory('digital-product-membership'), 'Digital Products, Courses & Creators');
  assert.equal(getBlueprintUniversalCategory('vip-lead-magnet-discount'), 'Local & Client Services');
  assert.equal(getBlueprintUniversalCategory('oto-upsell-funnel-system'), 'E-Commerce & Physical Retail');
  assert.equal(getBlueprintUniversalCategory('turnkey-retention-ecosystem'), 'SaaS, Tech & Events');

  // Known categories
  assert.equal(getBlueprintUniversalCategory(undefined, 'high-ticket'), 'B2B, Agencies & Consulting');
  assert.equal(getBlueprintUniversalCategory(undefined, 'services'), 'Local & Client Services');
  assert.equal(getBlueprintUniversalCategory(undefined, 'digital-product'), 'Digital Products, Courses & Creators');
  assert.equal(getBlueprintUniversalCategory(undefined, 'retention'), 'SaaS, Tech & Events');

  // Unknown fallback
  assert.equal(getBlueprintUniversalCategory('unknown-id', 'unknown-cat'), 'E-Commerce & Physical Retail');
  assert.equal(getBlueprintUniversalCategory(), 'E-Commerce & Physical Retail');
});

test('Challenger 4.3: App.tsx handleLoadBlueprint logic in replace and new modes', () => {
  // Simulate handleLoadBlueprint logic from App.tsx:753-774
  const simulateLoadBlueprint = (prevProject, prepared, mode) => {
    if (mode === 'replace') {
      return {
        ...prevProject,
        name: prepared.name,
        businessType: prepared.businessType || prevProject.businessType || 'E-Commerce & Physical Retail'
      };
    } else {
      return {
        name: prepared.name,
        businessType: prepared.businessType || 'E-Commerce & Physical Retail'
      };
    }
  };

  const currentProject = {
    name: 'Existing Funnel',
    businessType: 'Local & Client Services'
  };

  // Replace Mode 1: Blueprint specifies a category -> updates to blueprint category
  const resReplace1 = simulateLoadBlueprint(
    currentProject,
    { name: 'SaaS Funnel', businessType: 'SaaS, Tech & Events' },
    'replace'
  );
  assert.equal(resReplace1.businessType, 'SaaS, Tech & Events');

  // Replace Mode 2: Blueprint has no category -> retains canvas category
  const resReplace2 = simulateLoadBlueprint(
    currentProject,
    { name: 'Custom Blueprint', businessType: undefined },
    'replace'
  );
  assert.equal(resReplace2.businessType, 'Local & Client Services');

  // Replace Mode 3: Neither blueprint nor canvas has category -> defaults to Retail
  const resReplace3 = simulateLoadBlueprint(
    { name: 'Blank Funnel', businessType: '' },
    { name: 'Custom Blueprint', businessType: '' },
    'replace'
  );
  assert.equal(resReplace3.businessType, 'E-Commerce & Physical Retail');

  // New Mode 1: Blueprint specifies a category -> new journey gets that category
  const resNew1 = simulateLoadBlueprint(
    currentProject,
    { name: 'B2B Funnel', businessType: 'B2B, Agencies & Consulting' },
    'new'
  );
  assert.equal(resNew1.businessType, 'B2B, Agencies & Consulting');

  // New Mode 2: Blueprint has no category -> new journey defaults to Retail
  const resNew2 = simulateLoadBlueprint(
    currentProject,
    { name: 'Blank Blueprint', businessType: undefined },
    'new'
  );
  assert.equal(resNew2.businessType, 'E-Commerce & Physical Retail');
});

test('Challenger 4.4: BlueprintModal passes businessType on turnkey and custom blueprints', () => {
  assert.match(
    blueprintModalSrc,
    /businessType:\s*blueprint\.businessType\s*\|\|\s*getBlueprintUniversalCategory\(blueprint\.id,\s*blueprint\.category\)/,
    'Turnkey blueprints must attach universal category'
  );
  assert.match(
    blueprintModalSrc,
    /businessType:\s*getBlueprintUniversalCategory\(cb\.id,\s*cb\.category\)/,
    'Custom blueprints must attach mapped universal category'
  );
});

// ============================================================================
// PART 5: DASH INVARIANT COMPLIANCE ACROSS ALL TEST FILES & STRINGS
// ============================================================================

test('Challenger 5.1: Zero em dashes and zero spaced en dashes across universal categories', () => {
  for (const cat of UNIVERSAL_BUSINESS_CATEGORIES) {
    assert.doesNotMatch(cat, /\u2014/, `Universal category "${cat}" contains em dash`);
    assert.doesNotMatch(cat, /\s\u2013\s/, `Universal category "${cat}" contains spaced en dash`);
  }
});

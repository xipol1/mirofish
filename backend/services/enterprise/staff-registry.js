/**
 * Staff Registry
 *
 * Maintains named hotel staff entities that persist across the stay's stages.
 * Without this, each LLM call reinvents staff names and no rapport/trust arc
 * can form. With this, "Javier" at check-in can reappear at dinner and check-out,
 * building or eroding rapport with compound effect.
 *
 * The registry carries:
 *   - Named staff members the guest has interacted with
 *   - Their role, shift pattern, personality archetype
 *   - Accumulated rapport_score with this specific guest
 *   - Interaction history
 *
 * The narrative engine receives this registry in its prompt and is instructed
 * to REUSE these entities where plausible instead of inventing new ones.
 */

const STAFF_ROLES_BY_STAGE = {
  arrival: ['receptionist', 'bellhop', 'doorman', 'valet', 'lobby_host'],
  room_first_impression: ['room_attendant', 'butler_in_suite_tier'],
  evening_1: ['concierge', 'restaurant_host', 'waiter', 'sommelier', 'bartender'],
  night_1: ['night_receptionist', 'security'],
  morning_routine: ['breakfast_host', 'breakfast_waiter', 'coffee_barista'],
  daytime_activity: ['pool_butler', 'beach_concierge', 'spa_receptionist', 'therapist', 'kids_club_leader', 'activities_host'],
  lunch: ['pool_bar_waiter', 'lunch_restaurant_waiter', 'sommelier'],
  afternoon_activity: ['pool_butler', 'beach_concierge', 'spa_therapist'],
  dinner: ['restaurant_host', 'waiter', 'sommelier', 'chef_visiting_table', 'maitre_d'],
  evening_leisure: ['bartender', 'lobby_host', 'piano_player'],
  last_morning: ['breakfast_host', 'housekeeping', 'receptionist'],
  checkout: ['receptionist', 'bellhop', 'manager_on_duty', 'valet'],
  post_stay: ['loyalty_manager', 'guest_relations'],
};

// Realistic staff name bank mixing common Iberian + international names
const STAFF_FIRST_NAMES = [
  // Iberian core (most common for a Menorca hotel)
  'Javier', 'María', 'Carlos', 'Ana', 'Pablo', 'Elena', 'Jordi', 'Núria',
  'Miguel', 'Laura', 'Sergio', 'Carmen', 'Raúl', 'Isabel', 'Antonio', 'Marta',
  'Joan', 'Aina', 'Tomeu', 'Francesca', 'Biel', 'Margalida',
  // International (visa-workers, second-generation)
  'Luca', 'Giulia', 'Pierre', 'Sophie', 'Viktor', 'Ingrid', 'Mohammed', 'Fatima',
  'Ashley', 'James', 'Priya', 'Rohan',
];

const STAFF_PERSONALITIES = [
  { key: 'warm_proactive', traits: 'remembers guest, offers unsolicited help, genuine warmth', rapport_base: 4 },
  { key: 'competent_efficient', traits: 'precise, quick, factual, no small talk', rapport_base: 1 },
  { key: 'scripted_polite', traits: 'smiling but scripted, not improvising, reading from manual', rapport_base: -1 },
  { key: 'veteran_senior', traits: 'long-tenure, anticipates needs, refined service', rapport_base: 5 },
  { key: 'new_apologetic', traits: 'recently hired, apologizes often, needs to check with supervisor', rapport_base: -2 },
  { key: 'tired_overworked', traits: 'stretched, transactional, minimal eye contact', rapport_base: -3 },
  { key: 'charismatic_memorable', traits: 'personality-driven, tells jokes, remembers details effortlessly', rapport_base: 6 },
  { key: 'rushed_functional', traits: 'knows what to do but clearly behind schedule', rapport_base: 0 },
];

function rollRole(stageLabel) {
  const options = STAFF_ROLES_BY_STAGE[stageLabel] || ['staff'];
  return options[Math.floor(Math.random() * options.length)];
}

function rollName() {
  return STAFF_FIRST_NAMES[Math.floor(Math.random() * STAFF_FIRST_NAMES.length)];
}

function rollPersonality(staffingQualityHint = null) {
  // If staffingQualityHint = 'under-trained' bias toward scripted_polite / new_apologetic / tired
  // If 'senior' bias toward warm_proactive / veteran_senior / charismatic
  const hints = {
    'under-trained': ['scripted_polite', 'new_apologetic', 'tired_overworked'],
    senior: ['warm_proactive', 'veteran_senior', 'charismatic_memorable'],
    balanced: null,
  };
  const allowedKeys = hints[staffingQualityHint];
  const pool = allowedKeys
    ? STAFF_PERSONALITIES.filter(p => allowedKeys.includes(p.key))
    : STAFF_PERSONALITIES;
  return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * Create a new staff entity. The registry accumulates these as the stay progresses.
 */
function createStaffEntity({ role, stage, staffingQualityHint = null }) {
  const personality = rollPersonality(staffingQualityHint);
  return {
    id: `s${Date.now().toString(36).slice(-4)}${Math.floor(Math.random() * 1000)}`,
    name: rollName(),
    role,
    first_met_stage: stage,
    personality_key: personality.key,
    personality_traits: personality.traits,
    rapport_score: personality.rapport_base, // starts positive or negative based on personality
    interactions: [],
    shift_pattern: Math.random() < 0.4 ? 'morning' : Math.random() < 0.7 ? 'evening' : 'night',
  };
}

/**
 * Fetch an existing staff member suitable for a stage (by role match), or null if none.
 */
function findSuitableExistingStaff(registry, stageLabel) {
  const validRoles = STAFF_ROLES_BY_STAGE[stageLabel] || [];
  return registry.filter(s => validRoles.includes(s.role));
}

/**
 * Decide, for a stage, which staff members are "in play" — mix of reusing
 * previously-encountered and introducing new ones. Reuse probability scales
 * with stage position and role availability.
 */
function pickStaffForStage({ registry, stageLabel, stayLengthNights = 3, stageIndex = 0, staffingQualityHint = null }) {
  const existingCandidates = findSuitableExistingStaff(registry, stageLabel);

  // Probability of encountering at least one returning staff member
  // Increases with stay length and stage index (later stages more likely)
  const returnProb = Math.min(0.75, 0.15 + stageIndex * 0.08 + (stayLengthNights - 3) * 0.06);

  const staffInPlay = [];

  // Optionally reuse
  if (existingCandidates.length > 0 && Math.random() < returnProb) {
    const reused = existingCandidates[Math.floor(Math.random() * existingCandidates.length)];
    staffInPlay.push({ ...reused, is_returning: true });
  }

  // Introduce up to 1 new staff member per stage
  const introduceNew = Math.random() < 0.7; // most stages introduce new
  if (introduceNew) {
    const role = rollRole(stageLabel);
    const entity = createStaffEntity({ role, stage: stageLabel, staffingQualityHint });
    registry.push(entity);
    staffInPlay.push({ ...entity, is_returning: false });
  }

  return staffInPlay;
}

/**
 * Record an interaction: the LLM output for the stage tells us what happened.
 * We update rapport based on moments_positive/negative and the personality.
 */
function recordInteraction({ registry, staffId, stage, outcome }) {
  const entity = registry.find(s => s.id === staffId);
  if (!entity) return;

  const delta = outcome.rapport_delta != null
    ? outcome.rapport_delta
    : (outcome.was_positive ? 2 : outcome.was_negative ? -3 : 0);

  entity.rapport_score = Math.max(-10, Math.min(10, entity.rapport_score + delta));
  entity.interactions.push({
    stage,
    was_positive: !!outcome.was_positive,
    was_negative: !!outcome.was_negative,
    note: (outcome.note || '').substring(0, 200),
    ts: Date.now(),
  });
}

/**
 * Build the prompt block handed to the narrative engine at each stage.
 * Tells the LLM which staff entities are "in play" and what their relationship
 * with this guest looks like.
 */
function buildStaffPromptBlock(staffInPlay) {
  if (!staffInPlay || staffInPlay.length === 0) return '';

  const lines = ['=== STAFF IN THIS STAGE (USE THESE NAMES — DO NOT INVENT NEW STAFF) ==='];
  for (const s of staffInPlay) {
    const rapportSignal = s.rapport_score >= 4 ? 'warm rapport already built'
      : s.rapport_score >= 1 ? 'polite positive history'
      : s.rapport_score >= -1 ? 'neutral / transactional'
      : s.rapport_score >= -4 ? 'some tension / recent friction'
      : 'adversarial / damaged';
    const priorInteractions = s.interactions?.length > 0
      ? ` (${s.interactions.length} prior interactions this stay: ${s.interactions.filter(i => i.was_positive).length}+ / ${s.interactions.filter(i => i.was_negative).length}-)`
      : s.is_returning ? ' (returning — guest recognizes them)' : ' (first meeting)';

    lines.push(`- ${s.name} (${s.role.replace(/_/g, ' ')}) — personality: ${s.personality_traits}. Rapport with this guest: ${rapportSignal}${priorInteractions}.`);
  }
  lines.push('');
  lines.push('When narrating staff interactions in this stage, USE THESE SPECIFIC PEOPLE. If one is returning, the guest likely notices and the interaction reflects their accumulated relationship.');
  return lines.join('\n');
}

module.exports = {
  createStaffEntity,
  pickStaffForStage,
  recordInteraction,
  buildStaffPromptBlock,
  findSuitableExistingStaff,
  STAFF_ROLES_BY_STAGE,
};

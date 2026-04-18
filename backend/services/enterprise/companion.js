/**
 * Companion Dynamics — models co-travelers (spouse, partner, children) whose
 * independent moods cross-contaminate the primary guest's experience.
 *
 * A honeymooner is really TWO people whose moods merge. A family stay is
 * 2 adults + N children whose excitement/tantrum/fatigue cycles drive 70% of
 * the parental experience. The old sim modeled each archetype as a solo unit,
 * which is why "stunning sea view" beat "kid screamed through dinner".
 *
 * Per stage, each companion:
 *   1. Catches a fraction of the primary's mood via social contagion.
 *   2. Rolls an independent event (own positive or negative moment).
 *   3. Has a quirks-driven reaction to the stage (kid loves pool, partner
 *      hates slow service).
 *
 * The primary's sensation deltas are then pulled toward the companion-weighted
 * average. A honeymooner whose partner had a bad moment loses some delight
 * even if their own experience was fine.
 */

const FIRST_NAMES_BY_ORIGIN = {
  german_dach:     { m: ['Lukas', 'Jonas', 'Felix', 'Maximilian', 'Tobias'], f: ['Hannah', 'Laura', 'Anna', 'Emma', 'Katharina'] },
  anglo_uk_ireland:{ m: ['Oliver', 'James', 'Jack', 'William', 'Harry'],      f: ['Olivia', 'Amelia', 'Isla', 'Sophie', 'Grace'] },
  anglo_us_canada: { m: ['Liam', 'Ethan', 'Noah', 'Mason', 'Logan'],           f: ['Ava', 'Mia', 'Charlotte', 'Harper', 'Ella'] },
  latin_spain_italy:{m: ['Alejandro', 'Marco', 'Luca', 'Pablo', 'Matteo'],     f: ['Sofia', 'Lucia', 'Chiara', 'Martina', 'Elena'] },
  french:          { m: ['Louis', 'Gabriel', 'Hugo', 'Théo', 'Arthur'],        f: ['Léa', 'Chloé', 'Emma', 'Jade', 'Louise'] },
  nordic:          { m: ['Oskar', 'Lars', 'Henrik', 'Anders', 'Erik'],         f: ['Emma', 'Astrid', 'Freja', 'Linnea', 'Saga'] },
  east_asian:      { m: ['Hiroshi', 'Wei', 'Jun', 'Takeshi', 'Min'],           f: ['Yuki', 'Lin', 'Aiko', 'Sakura', 'Xia'] },
  middle_east_gcc: { m: ['Ahmed', 'Omar', 'Khalid', 'Faisal', 'Hassan'],       f: ['Fatima', 'Aisha', 'Layla', 'Noor', 'Sara'] },
  latam:           { m: ['Diego', 'Carlos', 'Rafael', 'Gabriel', 'Mateo'],     f: ['Valentina', 'Camila', 'Isabella', 'Sofia', 'Mariana'] },
  _default:        { m: ['Alex', 'Sam', 'Chris', 'Jordan', 'Taylor'],          f: ['Alex', 'Sam', 'Chris', 'Jordan', 'Taylor'] },
};

const TEMPERAMENTS = [
  { key: 'easygoing',       contagion: 0.25, positivity_bias: 0.15, trigger_sensitivity: 0.7 },
  { key: 'enthusiastic',    contagion: 0.35, positivity_bias: 0.25, trigger_sensitivity: 0.9 },
  { key: 'demanding',       contagion: 0.40, positivity_bias: -0.10, trigger_sensitivity: 1.4 },
  { key: 'anxious',         contagion: 0.50, positivity_bias: -0.15, trigger_sensitivity: 1.2 },
  { key: 'playful',         contagion: 0.30, positivity_bias: 0.20, trigger_sensitivity: 0.9 },
  { key: 'analytical',      contagion: 0.15, positivity_bias: 0.00, trigger_sensitivity: 0.8 },
  { key: 'affectionate',    contagion: 0.45, positivity_bias: 0.15, trigger_sensitivity: 1.0 },
  { key: 'stoic',           contagion: 0.10, positivity_bias: 0.00, trigger_sensitivity: 0.6 },
];

// Child-specific temperaments with higher volatility
const CHILD_TEMPERAMENTS = [
  { key: 'energetic',       contagion: 0.55, positivity_bias: 0.10, trigger_sensitivity: 1.8, child: true },
  { key: 'shy',             contagion: 0.40, positivity_bias: -0.05, trigger_sensitivity: 1.4, child: true },
  { key: 'adventurous',     contagion: 0.50, positivity_bias: 0.30, trigger_sensitivity: 1.3, child: true },
  { key: 'picky',           contagion: 0.45, positivity_bias: -0.15, trigger_sensitivity: 1.6, child: true },
  { key: 'sleepy',          contagion: 0.35, positivity_bias: 0.05, trigger_sensitivity: 1.1, child: true },
];

// Stage-specific triggers per relationship
const STAGE_TRIGGERS_BY_RELATIONSHIP = {
  spouse: {
    arrival:                { positive: 'quiet arrival together', negative: 'bickering about logistics after travel' },
    room_first_impression:  { positive: 'admiring the room together, taking it in', negative: 'one wanted a different room type' },
    morning_routine:        { positive: 'slow coffee together on the terrace', negative: 'one wakes up grumpy' },
    daytime_activity:       { positive: 'shared excitement for the beach/pool', negative: 'disagreement about whether to book an activity' },
    lunch:                  { positive: 'shared small plates and wine', negative: 'one orders something bad and silently regrets' },
    dinner:                 { positive: 'tasting menu together, good conversation', negative: 'tired and eating in silence' },
    checkout:               { positive: 'wistful goodbye, already planning next trip', negative: 'rushed departure, forgotten item in room' },
  },
  partner: {
    arrival:                { positive: 'exciting arrival, good energy', negative: 'travel stress spills over' },
    daytime_activity:       { positive: 'spontaneous adventure together', negative: 'one is bored while the other is enjoying' },
    dinner:                 { positive: 'flirting over dessert', negative: 'awkward silence' },
  },
  child_under_6: {
    arrival:                { positive: 'wide-eyed at everything', negative: 'meltdown from travel exhaustion' },
    room_first_impression:  { positive: 'bouncing on the bed, exploring', negative: 'unfamiliar room, clingy' },
    morning_routine:        { positive: 'cereals they love + cartoons on', negative: 'refuses to eat breakfast' },
    daytime_activity:       { positive: 'pool kid excitement, slide repeat 40 times', negative: 'sunburn, tired cranky' },
    lunch:                  { positive: 'kid menu nailed', negative: 'refuses everything, tantrum' },
    dinner:                 { positive: 'falls asleep in parent lap peacefully', negative: 'refuses to sit, runs around, embarrassing' },
  },
  child_6_to_12: {
    arrival:                { positive: 'excited about hotel features', negative: 'bored in car/plane, wants screen time' },
    daytime_activity:       { positive: 'kids club friends made, activity loved', negative: 'kids club was boring' },
    dinner:                 { positive: 'tried something new', negative: 'menu has nothing they like' },
  },
  teen: {
    arrival:                { positive: 'casually impressed', negative: 'phone-absorbed, uninterested' },
    daytime_activity:       { positive: 'instagram-worthy, took many photos', negative: 'wifi bad, complains' },
    dinner:                 { positive: 'enjoyed dessert at least', negative: 'dressed inappropriately, grudgingly attended' },
  },
};

function rollFromDist(entries) {
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let r = Math.random() * total;
  for (const [k, w] of entries) { r -= w; if (r <= 0) return k; }
  return entries[0][0];
}

function rollName(originCluster, gender) {
  const pool = FIRST_NAMES_BY_ORIGIN[originCluster] || FIRST_NAMES_BY_ORIGIN._default;
  const list = gender === 'f' ? pool.f : gender === 'm' ? pool.m : [...pool.m, ...pool.f];
  return list[Math.floor(Math.random() * list.length)];
}

function rollTemperament(isChild = false) {
  const pool = isChild ? CHILD_TEMPERAMENTS : TEMPERAMENTS;
  return pool[Math.floor(Math.random() * pool.length)];
}

function classifyChildBucket(age) {
  if (age < 6) return 'child_under_6';
  if (age < 13) return 'child_6_to_12';
  return 'teen';
}

/**
 * Generate companion(s) for a primary guest. Returns [] for solo archetypes.
 */
function generateCompanions({ persona, archetypeId, tripPurpose, culturalContext }) {
  const cluster = culturalContext?.culture_cluster || '_default';
  const primaryAge = typeof persona.age === 'number' ? persona.age : 40;

  const companions = [];

  // Decide group composition based on archetype + trip_purpose
  const needsPartner = (
    archetypeId === 'honeymooner'
    || archetypeId === 'family_vacationer'
    || (archetypeId === 'luxury_seeker' && (tripPurpose === 'leisure_couples' || tripPurpose === 'honeymoon'))
    || tripPurpose === 'leisure_couples'
    || tripPurpose === 'honeymoon'
    || tripPurpose === 'leisure_family'
  );

  if (needsPartner) {
    const partnerGender = persona.gender === 'f' || persona.gender === 'female' ? 'm' : 'f';
    const partnerAge = Math.round(primaryAge + (Math.random() * 8 - 4));
    const temperament = rollTemperament(false);
    companions.push({
      companion_id: `c_${Math.random().toString(36).slice(2, 9)}`,
      name: rollName(cluster, partnerGender),
      relationship: archetypeId === 'honeymooner' ? 'spouse' : 'partner',
      age: partnerAge,
      gender: partnerGender,
      temperament_key: temperament.key,
      contagion_weight: temperament.contagion,
      positivity_bias: temperament.positivity_bias,
      trigger_sensitivity: temperament.trigger_sensitivity,
      mood_0_100: 55 + Math.round((Math.random() - 0.5) * 20), // start near neutral-positive
      independent_events: [],
      quirks: rollQuirks(2),
      is_child: false,
    });
  }

  // Family adds children
  if (archetypeId === 'family_vacationer' || tripPurpose === 'leisure_family') {
    const nKids = Math.random() < 0.5 ? 1 : Math.random() < 0.8 ? 2 : 3;
    for (let i = 0; i < nKids; i++) {
      const kidAge = Math.floor(Math.random() * 16) + 2; // 2-17
      const kidGender = Math.random() < 0.5 ? 'm' : 'f';
      const temperament = rollTemperament(true);
      companions.push({
        companion_id: `c_${Math.random().toString(36).slice(2, 9)}`,
        name: rollName(cluster, kidGender),
        relationship: classifyChildBucket(kidAge),
        age: kidAge,
        gender: kidGender,
        temperament_key: temperament.key,
        contagion_weight: temperament.contagion,
        positivity_bias: temperament.positivity_bias,
        trigger_sensitivity: temperament.trigger_sensitivity,
        mood_0_100: 60 + Math.round((Math.random() - 0.5) * 20),
        independent_events: [],
        quirks: rollKidQuirks(kidAge, 2),
        is_child: true,
      });
    }
  }

  return companions;
}

const ADULT_QUIRKS = [
  'insists on morning coffee before speaking to anyone',
  'allergic to shellfish',
  'vegan',
  'mild fear of elevators',
  'must have the window side of the bed',
  'will not use scented toiletries',
  'only drinks still water, refuses sparkling',
  'gets seasick / motion sensitive',
  'former chef — scrutinises every meal',
  'writes detailed review on return',
  'loves early morning swims',
  'compulsively photographs food',
  'allergy to cats — reactive to pet rooms',
  'lactose intolerant',
  'gluten-sensitive',
  'light sleeper; earplugs every night',
  'hates having strangers touch luggage',
  'prefers cash, not digital wallets',
  'long shower routine, 25+ minutes',
  'strict runner; needs 6am treadmill',
];

const KID_QUIRKS_BY_AGE = {
  toddler: ['refuses to sleep without a specific stuffed animal', 'will only eat pasta plain', 'afraid of hotel hairdryers', 'loves pressing elevator buttons', 'hates water on face'],
  child: ['obsessed with swimming pool slides', 'only eats chicken nuggets', 'needs wifi for a specific game', 'allergic to strawberries', 'very shy with strangers', 'loves animals — asks about the hotel cat'],
  teen: ['wifi obsessed, speed-tests on arrival', 'vegan phase', 'always in headphones', 'photographs everything for instagram', 'sleeps until 11am', 'refuses family dinner seating'],
};

function rollQuirks(n) {
  const picked = [];
  const pool = [...ADULT_QUIRKS];
  while (picked.length < n && pool.length) {
    picked.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  }
  return picked;
}

function rollKidQuirks(age, n) {
  const bucket = age < 6 ? 'toddler' : age < 13 ? 'child' : 'teen';
  const pool = [...KID_QUIRKS_BY_AGE[bucket]];
  const picked = [];
  while (picked.length < n && pool.length) {
    picked.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  }
  return picked;
}

/**
 * Build the prompt block describing companions and their current mood.
 */
function buildCompanionPrompt(companions) {
  if (!companions || companions.length === 0) return '';
  const lines = ['=== YOUR TRAVEL COMPANIONS (their mood shapes your experience this stage) ==='];
  for (const c of companions) {
    const moodLabel = c.mood_0_100 >= 75 ? 'in great spirits'
      : c.mood_0_100 >= 55 ? 'doing fine'
      : c.mood_0_100 >= 35 ? 'moody / flat'
      : 'upset / struggling';
    lines.push(`• ${c.name} (${c.relationship.replace(/_/g, ' ')}, age ${c.age}, ${c.temperament_key}) — currently ${moodLabel} (${c.mood_0_100}/100). Quirks: ${c.quirks.join('; ')}.`);
  }
  lines.push('');
  lines.push('Write the stage as a JOINT experience. Mention their reactions. If a child is upset or a partner is frustrated, that shapes your own assessment regardless of the hotel\'s performance. Include at least one companion-driven detail per stage (e.g., "my partner loved the welcome champagne", "my son refused to eat the fish and we negotiated pasta instead").');
  return lines.join('\n');
}

/**
 * Update each companion's mood after the stage based on:
 *   - contagion from the primary guest's net emotional valence this stage
 *   - an independent roll driven by stage triggers
 *   - quirk-driven events (random)
 */
function updateCompanionsFromStage(companions, { stageLabel, stageResult, primaryMoodDelta = 0 }) {
  if (!companions || companions.length === 0) return { companions, companion_moments: [] };

  const nextCompanions = [];
  const companionMoments = [];
  const posCount = (stageResult?.moments_positive || []).length;
  const negCount = (stageResult?.moments_negative || []).length;
  const stageValence = posCount - negCount;

  for (const c of companions) {
    const nextC = { ...c, independent_events: [...(c.independent_events || [])] };

    // 1. Contagion from primary
    const contagionImpact = stageValence * 4 * c.contagion_weight;

    // 2. Independent event roll
    const triggers = STAGE_TRIGGERS_BY_RELATIONSHIP[c.relationship]?.[stageLabel];
    let independentImpact = 0;
    let independentDescription = null;
    if (triggers && Math.random() < 0.35 * c.trigger_sensitivity) {
      // Positive trigger more likely if temperament is positively biased
      const positiveProb = 0.55 + c.positivity_bias;
      const isPositive = Math.random() < positiveProb;
      const desc = isPositive ? triggers.positive : triggers.negative;
      const magnitude = Math.round((isPositive ? 6 : -8) * c.trigger_sensitivity);
      independentImpact = magnitude;
      independentDescription = desc;
      nextC.independent_events.push({
        stage: stageLabel,
        kind: isPositive ? 'positive' : 'negative',
        description: desc,
        impact: magnitude,
      });
      companionMoments.push({
        companion_name: c.name,
        relationship: c.relationship,
        stage: stageLabel,
        kind: isPositive ? 'positive' : 'negative',
        description: `${c.name}: ${desc}`,
      });
    }

    // 3. Passive drift (children get hungry/tired faster)
    const drift = c.is_child ? (Math.random() - 0.55) * 6 : (Math.random() - 0.5) * 3;

    nextC.mood_0_100 = Math.max(0, Math.min(100, Math.round(
      c.mood_0_100 + contagionImpact + independentImpact + drift
    )));
    nextCompanions.push(nextC);
  }

  return { companions: nextCompanions, companion_moments: companionMoments };
}

/**
 * Modulate the primary agent's sensation deltas based on companion moods.
 *
 * Intuition: a partner with a bad mood drags your emotional reading of the
 * stage down, even if the LLM wrote positive deltas. Weighted by relationship
 * closeness (spouse > partner > child closeness).
 */
function applyCompanionMoodToSensations(sensationDeltas, companions) {
  if (!sensationDeltas || !companions || companions.length === 0) return sensationDeltas;

  // Combined "companion mood" expressed as deviation from 55 (neutral-positive).
  // Spouse/partner weighted 0.35, children 0.20 each (up to cap).
  let moodInfluence = 0;
  let weightSum = 0;
  for (const c of companions) {
    const weight = c.is_child ? 0.20 : 0.35;
    const deviation = (c.mood_0_100 - 55) / 100; // -0.55..+0.45
    moodInfluence += weight * deviation * 100;
    weightSum += weight;
  }
  const normalized = weightSum > 0 ? moodInfluence / weightSum : 0;
  // Normalized is in [-55, +45]. Scale to a ±30% pull on primary's deltas.
  const pullFactor = normalized / 150; // roughly [-0.37, +0.30]

  const out = { ...sensationDeltas };
  for (const k of Object.keys(out)) {
    if (typeof out[k] !== 'number') continue;
    // Pull the delta toward the companion-mood direction.
    // If companions are happy, positive deltas amplified slightly, negatives dampened.
    // If companions unhappy, the reverse.
    out[k] = Math.round(out[k] + out[k] * pullFactor);
    // Additive small pressure on key relational dimensions
    if (['service_quality', 'personalization', 'aesthetic'].includes(k)) {
      out[k] += Math.round(pullFactor * 6);
    }
  }
  return out;
}

/**
 * Compact summary for the stay record.
 */
function summarize(companions) {
  if (!companions || companions.length === 0) return null;
  return {
    n_companions: companions.length,
    companions: companions.map(c => ({
      companion_id: c.companion_id,
      name: c.name,
      relationship: c.relationship,
      age: c.age,
      temperament_key: c.temperament_key,
      final_mood: c.mood_0_100,
      quirks: c.quirks,
      n_independent_events: (c.independent_events || []).length,
      independent_event_breakdown: {
        positive: (c.independent_events || []).filter(e => e.kind === 'positive').length,
        negative: (c.independent_events || []).filter(e => e.kind === 'negative').length,
      },
      independent_events: c.independent_events || [],
    })),
    avg_companion_mood: Math.round(companions.reduce((s, c) => s + c.mood_0_100, 0) / companions.length),
    children_count: companions.filter(c => c.is_child).length,
    partner_present: companions.some(c => c.relationship === 'spouse' || c.relationship === 'partner'),
  };
}

module.exports = {
  generateCompanions,
  buildCompanionPrompt,
  updateCompanionsFromStage,
  applyCompanionMoodToSensations,
  summarize,
  TEMPERAMENTS,
  CHILD_TEMPERAMENTS,
  STAGE_TRIGGERS_BY_RELATIONSHIP,
};

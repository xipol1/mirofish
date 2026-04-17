-- ─────────────────────────────────────────────────────────────
-- Synthetic Users Enterprise — Multi-tenant schema
-- ─────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── Organizations (tenants) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS orgs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'starter', -- starter|growth|business|enterprise
  sso_config JSONB DEFAULT '{}'::jsonb,
  settings JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  stripe_customer_id TEXT
);

-- ── Users ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  name TEXT,
  role TEXT NOT NULL DEFAULT 'viewer', -- admin|analyst|viewer
  clerk_user_id TEXT UNIQUE,
  created_at TIMESTAMPTZ DEFAULT now(),
  last_login_at TIMESTAMPTZ,
  UNIQUE(org_id, email)
);

-- ── Projects (a client product under test) ──────────────────
CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  product_url TEXT,
  description TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  archived_at TIMESTAMPTZ
);

-- ── Simulations (one launch test) ───────────────────────────
CREATE TABLE IF NOT EXISTS simulations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  parent_simulation_id UUID REFERENCES simulations(id), -- iteration lineage
  iteration INTEGER DEFAULT 0,

  task_type TEXT NOT NULL, -- landing_page|product_flow|marketing_campaign|pricing|onboarding|feature_validation
  goal TEXT,
  status TEXT NOT NULL DEFAULT 'pending', -- pending|running|completed|failed|cancelled

  target_url TEXT,
  starting_url TEXT,
  scenario_content TEXT,
  audience_description TEXT,
  audience_vector JSONB,

  config JSONB DEFAULT '{}'::jsonb,  -- agent_count, max_steps, concurrency, budget_usd
  requested_agent_count INTEGER DEFAULT 25,

  metrics JSONB,
  insights JSONB,
  recommendations JSONB,

  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  error_message TEXT,

  estimated_cost_usd NUMERIC(10,4),
  actual_cost_usd NUMERIC(10,4)
);

CREATE INDEX IF NOT EXISTS idx_simulations_org ON simulations(org_id);
CREATE INDEX IF NOT EXISTS idx_simulations_project ON simulations(project_id);
CREATE INDEX IF NOT EXISTS idx_simulations_status ON simulations(status);

-- ── Agent runs (one persona's journey within a simulation) ──
CREATE TABLE IF NOT EXISTS agent_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  simulation_id UUID NOT NULL REFERENCES simulations(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,

  slot_index INTEGER NOT NULL,
  persona JSONB NOT NULL,          -- full persona spec
  archetype_id TEXT NOT NULL,

  status TEXT NOT NULL DEFAULT 'pending', -- pending|running|completed|failed|abandoned

  -- Journey data
  starting_url TEXT,
  journey_steps JSONB DEFAULT '[]'::jsonb,   -- array of step objects
  final_state JSONB,                         -- patience/trust/frustration at end
  outcome TEXT,                              -- converted|bounced|interested|abandoned|completed_task|stuck
  outcome_reason TEXT,
  reasoning_trace TEXT,                      -- full CoT narrative

  -- Metrics
  steps_completed INTEGER DEFAULT 0,
  total_duration_ms INTEGER,
  engagement_score NUMERIC(3,2),

  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_agent_runs_sim ON agent_runs(simulation_id);

-- ── Evidence artifacts (screenshots, videos, DOM snapshots) ─
CREATE TABLE IF NOT EXISTS evidence (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_run_id UUID NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  simulation_id UUID NOT NULL REFERENCES simulations(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,

  kind TEXT NOT NULL, -- screenshot|dom|video|har|trace|accessibility
  step_index INTEGER,
  storage_key TEXT NOT NULL,  -- path in S3/R2/local storage
  mime_type TEXT,
  size_bytes BIGINT,
  metadata JSONB DEFAULT '{}'::jsonb,

  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_evidence_run ON evidence(agent_run_id);
CREATE INDEX IF NOT EXISTS idx_evidence_sim ON evidence(simulation_id);

-- ── Events (live progress + audit trail) ────────────────────
CREATE TABLE IF NOT EXISTS events (
  id BIGSERIAL PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  simulation_id UUID REFERENCES simulations(id) ON DELETE CASCADE,
  agent_run_id UUID REFERENCES agent_runs(id) ON DELETE CASCADE,

  type TEXT NOT NULL, -- phase_start|phase_complete|agent_step|agent_complete|llm_call|browser_action|error|audit
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_events_sim_time ON events(simulation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_events_run_time ON events(agent_run_id, created_at);

-- ── Reports (generated PDF/HTML artifacts) ──────────────────
CREATE TABLE IF NOT EXISTS reports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  simulation_id UUID NOT NULL REFERENCES simulations(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,

  kind TEXT NOT NULL DEFAULT 'pdf', -- pdf|html|json
  storage_key TEXT NOT NULL,
  title TEXT,
  summary TEXT,

  generated_by UUID REFERENCES users(id),
  generated_at TIMESTAMPTZ DEFAULT now()
);

-- ── Calibration feedback ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS calibration (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  simulation_id UUID NOT NULL REFERENCES simulations(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,

  metric_key TEXT NOT NULL,
  predicted_value NUMERIC,
  actual_value NUMERIC,
  change_implemented TEXT,
  notes TEXT,

  submitted_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ── Audit log ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_log (
  id BIGSERIAL PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  actor_user_id UUID REFERENCES users(id),
  action TEXT NOT NULL,         -- e.g. simulation.created, report.downloaded, sso.configured
  resource_type TEXT,
  resource_id UUID,
  details JSONB DEFAULT '{}'::jsonb,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_org_time ON audit_log(org_id, created_at DESC);

-- ─────────────────────────────────────────────────────────────
-- HOSPITALITY EXTENSIONS — properties, reviews, stays, sensations
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS properties (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,

  name TEXT NOT NULL,
  brand TEXT,
  slug TEXT NOT NULL,
  industry TEXT NOT NULL DEFAULT 'hospitality',

  website_url TEXT,
  booking_url TEXT,

  data_json JSONB NOT NULL DEFAULT '{}'::jsonb,      -- full property_template payload
  marketing_json JSONB DEFAULT '{}'::jsonb,
  operations_json JSONB DEFAULT '{}'::jsonb,
  loyalty_json JSONB DEFAULT '{}'::jsonb,

  historical_nps NUMERIC,
  historical_avg_rating NUMERIC,

  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  archived_at TIMESTAMPTZ,

  UNIQUE(org_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_properties_org ON properties(org_id);

-- Reviews ingested (scraped + uploaded)
CREATE TABLE IF NOT EXISTS reviews_ingested (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  property_id UUID REFERENCES properties(id) ON DELETE CASCADE,

  source TEXT NOT NULL,                              -- tripadvisor|booking|google|expedia|upload|twitter|tiktok|instagram
  source_review_id TEXT,
  source_url TEXT,

  rating_numeric NUMERIC,
  rating_scale NUMERIC,                              -- 5 for TA/Google, 10 for Booking
  title TEXT,
  body TEXT,
  reviewer_display_name TEXT,
  reviewer_origin TEXT,
  trip_type TEXT,                                    -- business|leisure_couples|leisure_family|solo|friends
  stay_month TEXT,                                   -- YYYY-MM
  language TEXT,

  themes_json JSONB DEFAULT '[]'::jsonb,             -- extracted tags (cleanliness|service|value|wifi|...)
  sentiment_score NUMERIC,                            -- -1..1
  raw_html TEXT,

  scraped_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE(source, source_review_id)
);

CREATE INDEX IF NOT EXISTS idx_reviews_property ON reviews_ingested(property_id);
CREATE INDEX IF NOT EXISTS idx_reviews_source ON reviews_ingested(source);

-- Stays (narrative simulations)
CREATE TABLE IF NOT EXISTS stays (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  simulation_id UUID REFERENCES simulations(id) ON DELETE CASCADE,
  agent_run_id UUID REFERENCES agent_runs(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  property_id UUID REFERENCES properties(id) ON DELETE SET NULL,

  persona JSONB NOT NULL,
  archetype_id TEXT NOT NULL,
  length_nights INTEGER,
  trip_purpose TEXT,
  arrival_context_json JSONB DEFAULT '{}'::jsonb,

  stages_json JSONB NOT NULL DEFAULT '[]'::jsonb,    -- array of stage events
  sensation_history_json JSONB DEFAULT '[]'::jsonb,  -- time-series of sensation states
  expenses_json JSONB DEFAULT '[]'::jsonb,           -- itemized spend

  total_spend_eur NUMERIC,
  final_sensation_json JSONB,
  predicted_nps NUMERIC,
  predicted_star_rating NUMERIC,
  predicted_review_platform TEXT,
  predicted_review_body TEXT,
  predicted_review_title TEXT,
  predicted_review_themes_json JSONB DEFAULT '[]'::jsonb,
  would_repeat_boolean BOOLEAN,
  would_recommend_boolean BOOLEAN,

  started_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_stays_sim ON stays(simulation_id);
CREATE INDEX IF NOT EXISTS idx_stays_property ON stays(property_id);

-- Property review aggregates (cached derived from reviews_ingested)
CREATE TABLE IF NOT EXISTS property_review_aggregates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,

  source TEXT,                                       -- can be 'all' for cross-platform
  review_count INTEGER,
  avg_rating_numeric NUMERIC,
  top_positive_themes_json JSONB DEFAULT '[]'::jsonb,
  top_negative_themes_json JSONB DEFAULT '[]'::jsonb,
  theme_frequencies_json JSONB DEFAULT '{}'::jsonb,
  sentiment_distribution_json JSONB DEFAULT '{}'::jsonb,

  computed_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_aggregates_property ON property_review_aggregates(property_id);

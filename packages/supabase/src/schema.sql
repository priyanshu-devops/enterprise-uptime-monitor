-- Supabase schema for Uptime Platform

CREATE TABLE IF NOT EXISTS settings (
  key VARCHAR(50) PRIMARY KEY,
  value JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS domains (
  domain VARCHAR(255) PRIMARY KEY,
  company VARCHAR(255),
  project VARCHAR(255),
  owner VARCHAR(255),
  department VARCHAR(255),
  website TEXT NOT NULL,
  status VARCHAR(50),
  http_status VARCHAR(50),
  https VARCHAR(10),
  redirect_url TEXT,
  response_time VARCHAR(50),
  ttfb VARCHAR(50),
  ssl_expiry VARCHAR(50),
  ssl_days_remaining VARCHAR(50),
  ssl_issuer VARCHAR(255),
  tls_version VARCHAR(50),
  domain_expiry VARCHAR(50),
  server_ip VARCHAR(50),
  dns TEXT,
  nameservers TEXT,
  hosting_provider VARCHAR(255),
  cdn VARCHAR(255),
  cloudflare VARCHAR(10),
  wordpress VARCHAR(10),
  cms VARCHAR(255),
  technology_stack TEXT,
  framework VARCHAR(255),
  meta_title TEXT,
  meta_description TEXT,
  robots_txt VARCHAR(10),
  sitemap_xml VARCHAR(10),
  security_headers TEXT,
  page_size VARCHAR(50),
  favicon VARCHAR(10),
  screenshot_url TEXT,
  thumbnail_url TEXT,
  image_formula TEXT,
  last_checked_date VARCHAR(50),
  last_checked_time VARCHAR(50),
  health_score VARCHAR(50),
  risk_score VARCHAR(50),
  error_message TEXT,
  monitoring_result TEXT,
  notes TEXT,
  tags TEXT,
  category VARCHAR(255),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGSERIAL PRIMARY KEY,
  timestamp VARCHAR(50) NOT NULL,
  actor VARCHAR(255),
  action VARCHAR(255),
  target TEXT,
  ip VARCHAR(50),
  user_agent TEXT,
  status VARCHAR(50),
  before TEXT,
  after TEXT,
  reason TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS incident_logs (
  id VARCHAR(100) PRIMARY KEY,
  domain VARCHAR(255) NOT NULL,
  type VARCHAR(50) NOT NULL,
  status VARCHAR(50) NOT NULL,
  opened_at VARCHAR(50) NOT NULL,
  resolved_at VARCHAR(50),
  from_status VARCHAR(50),
  to_status VARCHAR(50),
  message TEXT,
  duration_seconds DOUBLE PRECISION,
  acked_at VARCHAR(50),
  acked_by VARCHAR(255),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS import_history (
  import_id VARCHAR(100) PRIMARY KEY,
  imported_at VARCHAR(50) NOT NULL,
  actor VARCHAR(255),
  source VARCHAR(255),
  total_rows INTEGER,
  accepted INTEGER,
  duplicates INTEGER,
  invalid INTEGER,
  corrected INTEGER,
  skipped INTEGER,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

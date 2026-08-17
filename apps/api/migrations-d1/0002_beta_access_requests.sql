CREATE TABLE beta_access_requests (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  team_name TEXT,
  team_size TEXT NOT NULL CHECK(team_size IN ('solo','2-5','6-10','11-25','26+')),
  content_type TEXT NOT NULL CHECK(content_type IN ('podcast','youtube','studio','other')),
  monthly_hours TEXT NOT NULL CHECK(monthly_hours IN ('under-10','10-25','26-50','51-100','100+')),
  notes TEXT,
  consented_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','invited','declined')),
  source TEXT NOT NULL DEFAULT 'landing_page',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

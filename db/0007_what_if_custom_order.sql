ALTER TABLE web.what_if_depth_chart
  ADD COLUMN IF NOT EXISTS custom_order boolean NOT NULL DEFAULT false;
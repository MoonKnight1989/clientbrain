-- Seed client_domains with email domains for existing clients
-- These map attendee email domains to client IDs for automatic meeting attribution

INSERT INTO client_domains (client_id, domain) VALUES
  ('11111111-1111-1111-1111-111111111111', 'getnoan.com'),        -- NOAN
  ('cdf014d5-13cd-414c-ac69-9d6c14b97802', 'mercerlabs.com'),     -- Mercer Labs
  ('86f57e2e-7f3c-453e-b3cb-32d6fe4f09d4', 'nomono.co'),          -- Nomono
  ('aeda455c-8c9f-4077-ae79-2f5049d8049f', 'atlashps.co.uk'),     -- Atlas HPS
  ('931f78c1-3df1-4872-8ddd-e0c1f17a9be2', 'sondertattoolondon.com'), -- Sonder Tattoo London
  ('8d7c170d-702f-4d0c-8ee8-f05b57693dd6', 'houseofimpact.com'),  -- House Of Impact
  ('0ccb383c-f53c-4f12-8494-94aa86382042', 'springmediapartners.com'); -- Spring Media Partners

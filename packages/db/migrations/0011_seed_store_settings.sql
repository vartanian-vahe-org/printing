-- Default shop identity used in emails (Phase 2 step 5).
-- PLACEHOLDERS: brand name (docs/open-issues.md U1) and the .local addresses, which only work with
-- Mailpit in development. Change them in the admin / database before sending real email (open issue S15).
-- Data migration: runs once per environment. Insert-only (ON CONFLICT DO NOTHING).

INSERT INTO store_settings (id, store_name, support_email, order_notification_emails, created_by)
VALUES (1, 'Print Studio', 'support@printing.local', ARRAY['orders@printing.local'], 'system:migration')
ON CONFLICT (id) DO NOTHING;

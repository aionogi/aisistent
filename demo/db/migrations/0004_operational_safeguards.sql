-- Operational state contains only keyed digests, counters and expiry times.
-- The application computes the digest with a secret HMAC; IP addresses and
-- user identifiers are never written to this table.
CREATE TABLE app.rate_limit_buckets (
  bucket_key bytea PRIMARY KEY CHECK (octet_length(bucket_key) = 32),
  request_count integer NOT NULL CHECK (request_count BETWEEN 1 AND 10000),
  expires_at timestamptz NOT NULL
);
CREATE INDEX rate_limit_buckets_expires_idx ON app.rate_limit_buckets (expires_at);
ALTER TABLE app.rate_limit_buckets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app.rate_limit_buckets FROM PUBLIC, aisistent_runtime;

-- One row lock decides admission across every web process. The first request
-- starts a fixed window. Denied requests neither increment nor extend it.
CREATE FUNCTION app.consume_rate_limit(bucket_key bytea, max_requests integer, window_seconds integer)
  RETURNS TABLE (allowed boolean, retry_after_seconds integer)
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, app, pg_temp
  AS $$
  DECLARE
    checked_at timestamptz := clock_timestamp();
    bucket_expires timestamptz;
  BEGIN
    IF bucket_key IS NULL OR octet_length(bucket_key) <> 32
      OR max_requests IS NULL OR max_requests NOT BETWEEN 1 AND 10000
      OR window_seconds IS NULL OR window_seconds NOT BETWEEN 1 AND 86400 THEN
      RAISE EXCEPTION 'invalid_rate_limit_parameters' USING ERRCODE = '22023';
    END IF;

    INSERT INTO app.rate_limit_buckets AS bucket (bucket_key, request_count, expires_at)
      VALUES (consume_rate_limit.bucket_key, 1, checked_at + make_interval(secs => window_seconds))
      ON CONFLICT ON CONSTRAINT rate_limit_buckets_pkey DO UPDATE
        SET request_count = CASE WHEN bucket.expires_at <= checked_at THEN 1 ELSE bucket.request_count + 1 END,
            expires_at = CASE WHEN bucket.expires_at <= checked_at THEN excluded.expires_at ELSE bucket.expires_at END
        WHERE bucket.expires_at <= checked_at OR bucket.request_count < max_requests
      RETURNING expires_at INTO bucket_expires;

    IF FOUND THEN
      RETURN QUERY SELECT true, 0;
    ELSE
      SELECT bucket.expires_at INTO bucket_expires FROM app.rate_limit_buckets AS bucket
        WHERE bucket.bucket_key = consume_rate_limit.bucket_key;
      RETURN QUERY SELECT false, greatest(1, ceil(extract(epoch FROM bucket_expires - checked_at))::integer);
    END IF;
  END
  $$;

CREATE INDEX invitations_expires_idx ON app.invitations (expires_at);

-- Each invocation deletes at most batch_size rows from each operational table.
-- Locked rows are skipped, allowing independent cleanup jobs and request writes
-- to make progress. Durable memberships and the audit trail are never purged.
CREATE FUNCTION app.purge_operational_data(batch_size integer DEFAULT 500)
  RETURNS TABLE (sessions integer, invitations integer, rate_limits integer)
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, app, pg_temp
  AS $$
  DECLARE
    checked_at timestamptz := clock_timestamp();
  BEGIN
    IF batch_size IS NULL OR batch_size NOT BETWEEN 1 AND 1000 THEN
      RAISE EXCEPTION 'invalid_cleanup_batch_size' USING ERRCODE = '22023';
    END IF;

    WITH expired AS (
      SELECT id_hash FROM app.auth_sessions WHERE expires_at <= checked_at
        ORDER BY expires_at, id_hash LIMIT batch_size FOR UPDATE SKIP LOCKED
    )
    DELETE FROM app.auth_sessions AS session USING expired WHERE session.id_hash = expired.id_hash;
    GET DIAGNOSTICS sessions = ROW_COUNT;

    WITH expired AS (
      SELECT id FROM app.invitations WHERE expires_at <= checked_at
        ORDER BY expires_at, id LIMIT batch_size FOR UPDATE SKIP LOCKED
    )
    DELETE FROM app.invitations AS invitation USING expired WHERE invitation.id = expired.id;
    GET DIAGNOSTICS invitations = ROW_COUNT;

    WITH expired AS (
      SELECT bucket_key FROM app.rate_limit_buckets WHERE expires_at <= checked_at
        ORDER BY expires_at, bucket_key LIMIT batch_size FOR UPDATE SKIP LOCKED
    )
    DELETE FROM app.rate_limit_buckets AS bucket USING expired WHERE bucket.bucket_key = expired.bucket_key;
    GET DIAGNOSTICS rate_limits = ROW_COUNT;
    RETURN NEXT;
  END
  $$;

-- Retain the previous session-only API, but remove its unbounded deletion.
CREATE OR REPLACE FUNCTION app.auth_session_purge_expired() RETURNS integer
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, app, pg_temp
  AS $$
  DECLARE
    removed integer;
  BEGIN
    WITH expired AS (
      SELECT id_hash FROM app.auth_sessions WHERE expires_at <= clock_timestamp()
        ORDER BY expires_at, id_hash LIMIT 1000 FOR UPDATE SKIP LOCKED
    )
    DELETE FROM app.auth_sessions AS session USING expired WHERE session.id_hash = expired.id_hash;
    GET DIAGNOSTICS removed = ROW_COUNT;
    RETURN removed;
  END
  $$;

REVOKE ALL ON FUNCTION app.consume_rate_limit(bytea, integer, integer), app.purge_operational_data(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.consume_rate_limit(bytea, integer, integer), app.purge_operational_data(integer) TO aisistent_runtime;

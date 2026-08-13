-- Intensive sessions reserve teaching rooms only during teaching blocks and a
-- separate lunch/dinner room during the 30-minute lunch interval.

ALTER TABLE room
ADD COLUMN room_type text NOT NULL DEFAULT 'teaching';

ALTER TABLE room
ADD CONSTRAINT chk_room_type
CHECK (room_type IN ('teaching', 'lunch_dinner'));

INSERT INTO room (name, capacity, room_type)
VALUES
  ('Lunch Room 1', 10, 'lunch_dinner'),
  ('Lunch Room 2', 10, 'lunch_dinner'),
  ('Lunch Room 3', 10, 'lunch_dinner');

CREATE TABLE session_room_reservation (
  id serial PRIMARY KEY,
  session_id integer NOT NULL REFERENCES session(id) ON DELETE CASCADE,
  room_id integer NOT NULL REFERENCES room(id),
  reservation_type text NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_session_room_reservation_type
    CHECK (reservation_type IN ('teaching_block_1', 'lunch', 'teaching_block_2', 'teaching')),
  CONSTRAINT chk_session_room_reservation_time_order
    CHECK (ends_at > starts_at),
  CONSTRAINT chk_session_room_reservation_lunch_duration
    CHECK (reservation_type <> 'lunch' OR ends_at = starts_at + INTERVAL '30 minutes')
);

CREATE INDEX idx_session_room_reservation_session_id
  ON session_room_reservation (session_id);

CREATE INDEX idx_session_room_reservation_room_interval
  ON session_room_reservation (room_id, starts_at, ends_at);

INSERT INTO session_room_reservation (session_id, room_id, reservation_type, starts_at, ends_at)
SELECT id, room_id, 'teaching', starts_at, ends_at
FROM session
WHERE session_type IN ('short', 'standard');

WITH intensive_blocks AS (
  SELECT
    id,
    room_id,
    starts_at,
    starts_at + INTERVAL '90 minutes' AS lunch_starts_at,
    starts_at + INTERVAL '120 minutes' AS lunch_ends_at,
    ends_at,
    (
      SELECT lr.id
      FROM room lr
      WHERE lr.room_type = 'lunch_dinner'
        AND NOT EXISTS (
          SELECT 1
          FROM session_room_reservation existing
          JOIN session existing_session ON existing_session.id = existing.session_id
          WHERE existing.room_id = lr.id
            AND existing_session.status = 'scheduled'
            AND existing.starts_at < s.starts_at + INTERVAL '120 minutes'
            AND existing.ends_at > s.starts_at + INTERVAL '90 minutes'
        )
      ORDER BY lr.id
      LIMIT 1
    ) AS lunch_room_id
  FROM session s
  WHERE session_type = 'intensive'
)
INSERT INTO session_room_reservation (session_id, room_id, reservation_type, starts_at, ends_at)
SELECT id, room_id, 'teaching_block_1', starts_at, lunch_starts_at
FROM intensive_blocks
UNION ALL
SELECT id, COALESCE(lunch_room_id, (SELECT id FROM room WHERE room_type = 'lunch_dinner' ORDER BY id LIMIT 1)), 'lunch', lunch_starts_at, lunch_ends_at
FROM intensive_blocks
UNION ALL
SELECT id, room_id, 'teaching_block_2', lunch_ends_at, ends_at
FROM intensive_blocks;

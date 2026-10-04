-- Todo schema and sample rows. Runs on every boot as the postgres superuser,
-- so every statement is safe to repeat. Objects are owned by the todo role.
\set ON_ERROR_STOP on

SET ROLE todo;

CREATE TABLE IF NOT EXISTS todos (
  id         serial PRIMARY KEY,
  title      text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  done       boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO todos (title, done, created_at)
SELECT title, done, now() - age
FROM (VALUES
  ('Build NixOS images for the app and the database', true,  interval '3 hours'),
  ('Deploy PostgreSQL on Datum Cloud',               true,  interval '2 hours'),
  ('Publish the todo app through the Datum proxy',   false, interval '1 hour'),
  ('Water the plants',                               false, interval '0')
) AS seed(title, done, age)
WHERE NOT EXISTS (SELECT 1 FROM todos);

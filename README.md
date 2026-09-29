# Bloom for Bees

A small local garden journal and landing page for Bloom for Bees Day.

## Start the local app

From this folder, run:

~~~sh
ruby server.rb
~~~

Then open [http://localhost:8000](http://localhost:8000). Leave the terminal running while you use the app. Press Control+C in that terminal to stop it.

Ruby, WEBrick, and the sqlite3 gem are used by the server. The app creates data/bloom.sqlite3 on first run. That database stays on this computer and is ignored by Git. Back it up by copying the SQLite file while the server is stopped.

## What is included

- Public Bloom for Bees Day story and a personal plan keepsake.
- Private accounts with salted PBKDF2 password hashes and server-side sessions.
- Garden plan create, edit, search, filter, sort, planting progress, and delete.
- Profile, password, theme, and browser reminder settings.
- A bloom guide that encourages regionally appropriate plant choices.
- Installable app shell with static offline assets; private API responses are never cached.

The app is designed for one trusted local computer. It does not provide email verification, account recovery, remote hosting, or push notifications. Browser reminders appear only while the app is open; an optional browser notification is used on the selected day if permission is granted.

## Run checks

~~~sh
ruby -Itest test/run.rb
~~~

Tests use temporary databases and do not modify the app's local account database.

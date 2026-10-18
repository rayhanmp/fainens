/**
 * Every calendar decision in Fainens (salary periods, "today", due dates, daily buckets, renewals)
 * is made in the user's time zone. Pin the process to it before any date math runs, so a server
 * or container that defaults to UTC doesn't shift day boundaries to 07:00 WIB.
 *
 * Import this first in every process entry point. An explicit TZ in the environment still wins.
 */
export const APP_TIME_ZONE = "Asia/Jakarta";

if (!process.env.TZ) process.env.TZ = APP_TIME_ZONE;

ALTER TABLE "generation_jobs" ADD COLUMN "app_type" text DEFAULT 'farcaster' NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "app_type" text DEFAULT 'farcaster' NOT NULL;
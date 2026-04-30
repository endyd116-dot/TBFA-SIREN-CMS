CREATE TYPE "public"."donation_status" AS ENUM('pending', 'completed', 'failed', 'cancelled', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."donation_type" AS ENUM('regular', 'onetime');--> statement-breakpoint
CREATE TYPE "public"."member_status" AS ENUM('pending', 'active', 'suspended', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."member_type" AS ENUM('regular', 'family', 'volunteer', 'admin');--> statement-breakpoint
CREATE TYPE "public"."notice_category" AS ENUM('general', 'member', 'event', 'media');--> statement-breakpoint
CREATE TYPE "public"."support_category" AS ENUM('counseling', 'legal', 'scholarship', 'other');--> statement-breakpoint
CREATE TYPE "public"."support_status" AS ENUM('submitted', 'reviewing', 'supplement', 'matched', 'in_progress', 'completed', 'rejected');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "audit_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"user_type" varchar(20),
	"user_name" varchar(50),
	"action" varchar(100) NOT NULL,
	"target" varchar(100),
	"detail" text,
	"ip_address" varchar(45),
	"user_agent" varchar(500),
	"success" boolean DEFAULT true,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "donations" (
	"id" serial PRIMARY KEY NOT NULL,
	"member_id" integer,
	"donor_name" varchar(50) NOT NULL,
	"donor_phone" varchar(20),
	"donor_email" varchar(100),
	"amount" integer NOT NULL,
	"type" "donation_type" NOT NULL,
	"pay_method" varchar(20) NOT NULL,
	"status" "donation_status" DEFAULT 'pending' NOT NULL,
	"transaction_id" varchar(100),
	"pg_provider" varchar(30),
	"receipt_requested" boolean DEFAULT false,
	"receipt_issued" boolean DEFAULT false,
	"receipt_issued_at" timestamp,
	"campaign_tag" varchar(50),
	"is_anonymous" boolean DEFAULT false,
	"memo" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "faqs" (
	"id" serial PRIMARY KEY NOT NULL,
	"category" varchar(30) DEFAULT 'general',
	"question" varchar(300) NOT NULL,
	"answer" text NOT NULL,
	"sort_order" integer DEFAULT 0,
	"is_active" boolean DEFAULT true,
	"views" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "members" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" varchar(100) NOT NULL,
	"password_hash" varchar(255) NOT NULL,
	"name" varchar(50) NOT NULL,
	"phone" varchar(20),
	"type" "member_type" DEFAULT 'regular' NOT NULL,
	"status" "member_status" DEFAULT 'active' NOT NULL,
	"email_verified" boolean DEFAULT false,
	"login_fail_count" integer DEFAULT 0,
	"locked_until" timestamp,
	"last_login_at" timestamp,
	"last_login_ip" varchar(45),
	"agree_email" boolean DEFAULT true,
	"agree_sms" boolean DEFAULT true,
	"agree_mail" boolean DEFAULT false,
	"memo" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "members_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notices" (
	"id" serial PRIMARY KEY NOT NULL,
	"category" "notice_category" DEFAULT 'general' NOT NULL,
	"title" varchar(200) NOT NULL,
	"content" text NOT NULL,
	"author_id" integer,
	"author_name" varchar(50) DEFAULT '관리자',
	"is_pinned" boolean DEFAULT false,
	"is_published" boolean DEFAULT true,
	"views" integer DEFAULT 0,
	"thumbnail_url" varchar(500),
	"excerpt" varchar(300),
	"published_at" timestamp DEFAULT now(),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "support_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"request_no" varchar(30) NOT NULL,
	"member_id" integer NOT NULL,
	"category" "support_category" NOT NULL,
	"title" varchar(200) NOT NULL,
	"content" text NOT NULL,
	"attachments" text,
	"status" "support_status" DEFAULT 'submitted' NOT NULL,
	"assigned_member_id" integer,
	"assigned_expert_name" varchar(50),
	"assigned_at" timestamp,
	"admin_note" text,
	"supplement_note" text,
	"report_content" text,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "support_requests_request_no_unique" UNIQUE("request_no")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_members_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "donations" ADD CONSTRAINT "donations_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notices" ADD CONSTRAINT "notices_author_id_members_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "support_requests" ADD CONSTRAINT "support_requests_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "support_requests" ADD CONSTRAINT "support_requests_assigned_member_id_members_id_fk" FOREIGN KEY ("assigned_member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_user_idx" ON "audit_logs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_action_idx" ON "audit_logs" USING btree ("action");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_created_idx" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "donations_member_idx" ON "donations" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "donations_status_idx" ON "donations" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "donations_created_idx" ON "donations" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "faqs_category_idx" ON "faqs" USING btree ("category");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "faqs_sort_idx" ON "faqs" USING btree ("sort_order");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "members_email_idx" ON "members" USING btree ("email");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "members_type_idx" ON "members" USING btree ("type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "members_status_idx" ON "members" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notices_category_idx" ON "notices" USING btree ("category");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notices_pinned_idx" ON "notices" USING btree ("is_pinned");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notices_published_idx" ON "notices" USING btree ("is_published");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notices_created_idx" ON "notices" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "support_member_idx" ON "support_requests" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "support_status_idx" ON "support_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "support_category_idx" ON "support_requests" USING btree ("category");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "support_request_no_idx" ON "support_requests" USING btree ("request_no");
import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateVideos1792365226864 implements MigrationInterface {
  name = 'CreateVideos1792365226864';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."videos_status_enum" AS ENUM('draft', 'processing', 'ready', 'failed')`,
    );
    await queryRunner.query(
      `CREATE TABLE "videos" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "channel_id" uuid NOT NULL, "title" character varying(255) NOT NULL, "original_filename" character varying(255) NOT NULL, "content_type" character varying(127) NOT NULL, "size_bytes" bigint NOT NULL, "status" "public"."videos_status_enum" NOT NULL DEFAULT 'draft', "upload_id" character varying(255), "part_size_bytes" integer, "part_count" integer, "storage_key" character varying(512) NOT NULL, "thumbnail_key" character varying(512), "duration_seconds" numeric(12,3), "container_format" character varying(255), "video_codec" character varying(64), "width" integer, "height" integer, "bitrate" bigint, "fps" numeric(8,3), "ffprobe_metadata" jsonb, "failure_reason" text, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "CHK_62f42def63a6c73d3194814a51" CHECK ("size_bytes" > 0), CONSTRAINT "PK_e4c86c0cf95aff16e9fb8220f6b" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_023a8e4f3f1a34ff3d8ca04a4c" ON "videos" ("channel_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "videos" ADD CONSTRAINT "FK_023a8e4f3f1a34ff3d8ca04a4cc" FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "videos" DROP CONSTRAINT "FK_023a8e4f3f1a34ff3d8ca04a4cc"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_023a8e4f3f1a34ff3d8ca04a4c"`,
    );
    await queryRunner.query(`DROP TABLE "videos"`);
    await queryRunner.query(`DROP TYPE "public"."videos_status_enum"`);
  }
}

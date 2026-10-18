import {
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

export class InitiateUploadDto {
  /** Original file name, e.g. `aula.mp4`. */
  @IsString()
  @Length(1, 255)
  filename: string;

  /** File size in bytes; the upper bound is checked by the service. */
  @IsInt()
  @Min(1)
  size_bytes: number;

  /** Media type of the file; must start with `video/`. */
  @IsString()
  @Matches(/^video\//)
  @MaxLength(127)
  content_type: string;

  /** Video title; defaults to the file name without its extension. */
  @IsOptional()
  @IsString()
  @Length(1, 255)
  title?: string;
}

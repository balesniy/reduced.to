import { IsBoolean, IsOptional, IsPositive, IsString, IsUrl, MaxLength, MinLength } from 'class-validator';

export class ShortenerDto {
  @IsUrl(
    { allow_fragments: true, require_protocol: true },
    {
      message: 'Url is invalid',
    }
  )
  url: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  @MinLength(4)
  key?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsOptional()
  @IsPositive()
  expirationTime?: number;

  @IsOptional()
  @IsString()
  password?: string;

  // UTM parameters
  @IsOptional()
  @IsString()
  @MaxLength(100)
  utm_ref?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  utm_source?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  utm_medium?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  utm_campaign?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  utm_term?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  utm_content?: string;

  @IsBoolean()
  @IsOptional()
  temporary?: boolean;
}

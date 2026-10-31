import { IsEmail, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class RegisterDto {
  @IsEmail({}, { message: 'Email không hợp lệ.' })
  @MaxLength(254)
  email: string;

  @IsString()
  @MinLength(8, { message: 'Mật khẩu cần ít nhất 8 ký tự.' })
  @MaxLength(128)
  password: string;

  @IsString()
  @MinLength(2, { message: 'Họ tên cần ít nhất 2 ký tự.' })
  @MaxLength(100)
  fullName: string;
}

export class LoginDto {
  @IsEmail({}, { message: 'Email không hợp lệ.' })
  @MaxLength(254)
  email: string;

  @IsString()
  @MaxLength(128)
  password: string;
}

export class SendOtpDto {
  @IsEmail({}, { message: 'Email không hợp lệ.' })
  @MaxLength(254)
  email: string;
}

export class VerifyOtpDto extends SendOtpDto {
  @Matches(/^\d{6}$/, { message: 'Mã xác thực gồm 6 chữ số.' })
  code: string;
}

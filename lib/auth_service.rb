require 'base64'
require 'digest'
require 'openssl'
require 'securerandom'
require 'time'
require 'sqlite3'
require_relative 'errors'

class AuthService
  SESSION_SECONDS = 30 * 24 * 60 * 60
  PBKDF2_ITERATIONS = 310_000
  PASSWORD_PATTERN = /\A[^\x00-\x1f\x7f]+\z/

  def initialize(database, secure_cookie: false)
    @database = database
    @secure_cookie = secure_cookie
  end

  def register(name:, email:, password:)
    clean_name = validate_name(name)
    clean_email = validate_email(email)
    validate_password(password)
    salt = SecureRandom.random_bytes(16)
    hash = derive(password, salt)
    user_id = SecureRandom.uuid
    @database.create_account(id: user_id, name: clean_name, email: clean_email, salt: salt.unpack1('H*'), password_hash: hash.unpack1('H*'))
    issue_session(user_id)
  rescue SQLite3::ConstraintException
    raise AppError.new('That email already has an account. Try signing in instead.', status: 409, code: 'email_exists')
  end

  def login(email:, password:)
    clean_email = validate_email(email)
    raise AppError.new('Enter your password.', status: 422, code: 'invalid_input') unless password.is_a?(String) && password.length <= 128
    row = @database.user_by_email(clean_email)
    candidate = derive(password, row ? [row['password_salt']].pack('H*') : DUMMY_SALT)
    valid = row && secure_equal(candidate, [row['password_hash']].pack('H*'))
    raise AppError.new('Email or password is incorrect.', status: 401, code: 'invalid_credentials') unless valid
    issue_session(row['id'])
  end

  def session_from(request)
    token = cookie_value(request['Cookie'])
    return nil unless token
    token_hash = Digest::SHA256.hexdigest(token)
    session = @database.session_by_hash(token_hash)
    return nil unless session
    if session['expires_at'].to_i <= Time.now.to_i
      @database.delete_session(token_hash)
      return nil
    end
    user = @database.user_by_id(session['user_id'])
    user && { user: user, csrf: session['csrf_token'], token_hash: token_hash }
  end

  def verify_csrf!(request, session)
    supplied = request['X-CSRF-Token'].to_s
    expected = session && session[:csrf].to_s
    unless !expected.to_s.empty? && secure_equal(supplied, expected)
      raise AppError.new('Your session expired. Refresh the page and try again.', status: 403, code: 'csrf_failed')
    end
  end

  def logout(session)
    @database.delete_session(session[:token_hash]) if session
  end

  def change_password(session, current_password:, new_password:)
    row = @database.user_by_id(session[:user]['id'])
    unless current_password.is_a?(String) && current_password.length <= 128 && secure_equal(derive(current_password, [row['password_salt']].pack('H*')), [row['password_hash']].pack('H*'))
      raise AppError.new('Your current password is incorrect.', status: 401, code: 'invalid_credentials')
    end
    validate_password(new_password)
    salt = SecureRandom.random_bytes(16)
    @database.update_password(row['id'], salt.unpack1('H*'), derive(new_password, salt).unpack1('H*'))
    issue_session(row['id'])
  end

  def cookie_header(token, clear: false)
    pieces = ['bloom_session=' + (clear ? '' : token.to_s), 'Path=/', 'HttpOnly', 'SameSite=Strict']
    pieces << 'Max-Age=0' if clear
    pieces << "Max-Age=#{SESSION_SECONDS}" unless clear
    pieces << 'Secure' if @secure_cookie
    pieces.join('; ')
  end

  def self.user_json(row)
    { id: row['id'], name: row['name'], email: row['email'], createdAt: row['created_at'] }
  end

  private

  DUMMY_SALT = 'bloomforbees-fixed-timing-salt'.b.freeze

  def issue_session(user_id)
    token = SecureRandom.urlsafe_base64(32)
    csrf = SecureRandom.urlsafe_base64(32)
    @database.create_session(
      user_id: user_id,
      token_hash: Digest::SHA256.hexdigest(token),
      csrf_token: csrf,
      expires_at: Time.now.to_i + SESSION_SECONDS
    )
    user = @database.user_by_id(user_id)
    { user: user, csrf: csrf, cookie: cookie_header(token) }
  end

  def validate_name(value)
    unless value.is_a?(String) && PASSWORD_PATTERN.match?(value.strip) && value.strip.length.between?(2, 60)
      raise AppError.new('Enter a name between 2 and 60 characters.', status: 422, code: 'invalid_input')
    end
    value.strip
  end

  def validate_email(value)
    unless value.is_a?(String) && value.bytesize <= 254
      raise AppError.new('Enter a valid email address.', status: 422, code: 'invalid_input')
    end
    email = value.strip.downcase
    unless email.match?(/\A[^\s@]+@[^\s@]+\.[^\s@]+\z/)
      raise AppError.new('Enter a valid email address.', status: 422, code: 'invalid_input')
    end
    email
  end

  def validate_password(value)
    unless value.is_a?(String) && value.length.between?(10, 128) && PASSWORD_PATTERN.match?(value)
      raise AppError.new('Use a password between 10 and 128 characters.', status: 422, code: 'invalid_input')
    end
  end

  def derive(password, salt)
    OpenSSL::PKCS5.pbkdf2_hmac(password, salt, PBKDF2_ITERATIONS, 32, 'sha256')
  end

  def secure_equal(left, right)
    left = left.to_s.b
    right = right.to_s.b
    return false unless left.bytesize == right.bytesize
    OpenSSL.fixed_length_secure_compare(left, right)
  rescue NoMethodError
    left.bytes.zip(right.bytes).reduce(0) { |difference, (a, b)| difference | (a ^ b) }.zero?
  end

  def cookie_value(cookie_header)
    cookie_header.to_s.split(';').each do |part|
      name, value = part.strip.split('=', 2)
      return value if name == 'bloom_session' && value && !value.empty?
    end
    nil
  end
end

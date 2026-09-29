require 'date'
require 'json'
require 'fileutils'
require 'openssl'
require 'time'
require 'uri'
require_relative 'errors'
require_relative 'database'
require_relative 'auth_service'
require_relative 'rate_limiter'

class ApiApp
  PLACES = [
    'A pot or window box',
    'My garden',
    'A school or community space',
    'A shared garden'
  ].freeze
  SUNLIGHT = ['Full sun', 'Part shade', 'Mostly shade', 'Not sure yet'].freeze
  THEMES = %w[system light dark].freeze
  MAX_JSON_BYTES = 32 * 1024

  def initialize(public_dir:, database_path:, production: false, origin: nil, logger: nil)
    @public_dir = File.expand_path(public_dir)
    @database = Database.new(database_path)
    @auth = AuthService.new(@database, secure_cookie: production)
    @production = production
    @origin = origin
    @logger = logger
    @auth_limiter = RateLimiter.new(limit: 8, window_seconds: 15 * 60)
  end

  def handle(request, response)
    set_security_headers(response)
    if request.path.start_with?('/api/')
      response['Cache-Control'] = 'no-store'
      handle_api(request, response)
    else
      serve_static(request, response)
    end
  rescue AppError => error
    json_response(response, error.status, { error: error.message, code: error.code })
  rescue SQLite3::ConstraintException => error
    log_error('database_constraint', error)
    json_response(response, 409, { error: 'That change conflicts with existing account data.', code: 'conflict' })
  rescue StandardError => error
    log_error('request_failed', error)
    json_response(response, 500, { error: 'Something went wrong. Please try again.', code: 'server_error' })
  end

  private

  def handle_api(request, response)
    method = request.request_method
    path = request.path

    if method == 'GET' && path == '/api/session'
      session = @auth.session_from(request)
      if session
        json_response(response, 200, {
          user: AuthService.user_json(session[:user]),
          csrfToken: session[:csrf],
          settings: @database.settings_for(session[:user]['id'])
        })
      else
        json_response(response, 200, { user: nil, csrfToken: nil, settings: nil })
      end
      return
    end

    if method == 'POST' && %w[/api/auth/register /api/auth/login].include?(path)
      verify_origin!(request)
      enforce_rate_limit!(request)
      data = json_body(request)
      result = if path == '/api/auth/register'
        @auth.register(name: data['name'], email: data['email'], password: data['password'])
      else
        @auth.login(email: data['email'], password: data['password'])
      end
      response['Set-Cookie'] = result[:cookie]
      json_response(response, 200, {
        user: AuthService.user_json(result[:user]),
        csrfToken: result[:csrf],
        settings: @database.settings_for(result[:user]['id'])
      })
      return
    end

    session = @auth.session_from(request)
    raise AppError.new('Sign in to continue.', status: 401, code: 'authentication_required') unless session

    if %w[POST PUT PATCH DELETE].include?(method)
      verify_origin!(request)
      @auth.verify_csrf!(request, session)
    end
    data = %w[POST PUT PATCH DELETE].include?(method) ? json_body(request) : {}
    user_id = session[:user]['id']

    case [method, path]
    when ['POST', '/api/auth/logout']
      @auth.logout(session)
      response['Set-Cookie'] = @auth.cookie_header(nil, clear: true)
      json_response(response, 200, { ok: true })
    when ['POST', '/api/auth/password']
      result = @auth.change_password(session, current_password: data['currentPassword'], new_password: data['newPassword'])
      response['Set-Cookie'] = result[:cookie]
      json_response(response, 200, {
        user: AuthService.user_json(result[:user]),
        csrfToken: result[:csrf],
        settings: @database.settings_for(user_id)
      })
    when ['GET', '/api/garden']
      json_response(response, 200, { gardens: @database.gardens_for(user_id) })
    when ['POST', '/api/garden']
      garden = @database.create_garden(user_id, garden_attributes(data, partial: false))
      json_response(response, 201, { garden: garden })
    when ['GET', '/api/settings']
      json_response(response, 200, { settings: @database.settings_for(user_id) })
    when ['PUT', '/api/settings']
      json_response(response, 200, { settings: @database.update_settings(user_id, settings_attributes(data)) })
    when ['PATCH', '/api/profile']
      name = validate_text(data['name'], 'Name', 2, 60)
      email = validate_email(data['email'])
      begin
        row = @database.update_profile(user_id, name, email)
      rescue SQLite3::ConstraintException
        raise AppError.new('That email is already used by another account.', status: 409, code: 'email_exists')
      end
      json_response(response, 200, { user: AuthService.user_json(row) })
    when ['DELETE', '/api/account']
      confirmation = data['confirmation'].to_s.strip.downcase
      unless secure_equal(confirmation, session[:user]['email'].to_s.downcase)
        raise AppError.new('Type your account email to confirm deletion.', status: 422, code: 'confirmation_required')
      end
      @database.delete_account(user_id)
      response['Set-Cookie'] = @auth.cookie_header(nil, clear: true)
      json_response(response, 200, { ok: true })
      else
      if %w[PATCH PUT].include?(method) && (match = path.match(%r{\A/api/garden/([0-9a-f-]{36})\z}i))
        attributes = garden_attributes(data, partial: method == 'PATCH')
        garden = @database.update_garden(user_id, match[1], attributes)
        raise AppError.new('That garden entry no longer exists.', status: 404, code: 'not_found') unless garden
        json_response(response, 200, { garden: garden })
      elsif method == 'DELETE' && (match = path.match(%r{\A/api/garden/([0-9a-f-]{36})\z}i))
        deleted = @database.delete_garden(user_id, match[1])
        raise AppError.new('That garden entry no longer exists.', status: 404, code: 'not_found') unless deleted
        json_response(response, 200, { ok: true })
      else
        raise AppError.new('That endpoint does not exist.', status: 404, code: 'not_found')
      end
    end
  end

  def garden_attributes(data, partial:)
    raise AppError.new('Expected a JSON object.', status: 400, code: 'invalid_json') unless data.is_a?(Hash)
    allowed = %w[flower place sunlight notes targetDate planted]
    unknown = data.keys - allowed
    raise AppError.new('The garden entry contains an unknown field.', status: 422, code: 'invalid_input') unless unknown.empty?

    attributes = {}
    if !partial || data.key?('flower')
      attributes[:flower] = validate_text(data['flower'], 'Flower', 2, 100)
    end
    if !partial || data.key?('place')
      place = data['place']
      raise AppError.new('Choose a valid growing space.', status: 422, code: 'invalid_input') unless PLACES.include?(place)
      attributes[:place] = place
    end
    if !partial || data.key?('sunlight')
      sunlight = data['sunlight']
      raise AppError.new('Choose a valid sunlight option.', status: 422, code: 'invalid_input') unless SUNLIGHT.include?(sunlight)
      attributes[:sunlight] = sunlight
    end
    if !partial || data.key?('notes')
      attributes[:notes] = validate_text(data.fetch('notes', ''), 'Notes', 0, 500, allow_blank: true)
    end
    if !partial || data.key?('targetDate')
      attributes[:target_date] = validate_date(data['targetDate'])
    end
    if data.key?('planted')
      raise AppError.new('Planting status must be true or false.', status: 422, code: 'invalid_input') unless [true, false].include?(data['planted'])
      attributes[:planted] = data['planted']
    elsif !partial
      attributes[:planted] = false
    end
    attributes
  end

  def settings_attributes(data)
    raise AppError.new('Expected a JSON object.', status: 400, code: 'invalid_json') unless data.is_a?(Hash)
    theme = data['theme']
    reminder_enabled = data['reminderEnabled']
    unless THEMES.include?(theme) && [true, false].include?(reminder_enabled)
      raise AppError.new('Choose a valid theme and reminder setting.', status: 422, code: 'invalid_input')
    end
    {
      theme: theme,
      reminder_enabled: reminder_enabled,
      reminder_date: validate_date(data['reminderDate'])
    }
  end

  def validate_text(value, label, min, max, allow_blank: false)
    unless value.is_a?(String) && value.bytesize <= max * 4 && value.length <= max && !value.match?(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/)
      raise AppError.new("#{label} must be #{min}-#{max} characters.", status: 422, code: 'invalid_input')
    end
    clean = value.strip
    if !allow_blank && clean.length < min
      raise AppError.new("#{label} must be #{min}-#{max} characters.", status: 422, code: 'invalid_input')
    end
    clean
  end

  def validate_email(value)
    unless value.is_a?(String) && value.bytesize <= 254
      raise AppError.new('Enter a valid email address.', status: 422, code: 'invalid_input')
    end
    email = value.strip.downcase
    raise AppError.new('Enter a valid email address.', status: 422, code: 'invalid_input') unless email.match?(/\A[^\s@]+@[^\s@]+\.[^\s@]+\z/)
    email
  end

  def validate_date(value)
    return nil if value.nil? || value == ''
    raise AppError.new('Choose a valid date.', status: 422, code: 'invalid_input') unless value.is_a?(String)
    Date.iso8601(value).iso8601
  rescue Date::Error
    raise AppError.new('Choose a valid date.', status: 422, code: 'invalid_input')
  end

  def secure_equal(left, right)
    left = left.to_s.b
    right = right.to_s.b
    return false unless left.bytesize == right.bytesize
    OpenSSL.fixed_length_secure_compare(left, right)
  rescue NoMethodError
    left.bytes.zip(right.bytes).reduce(0) { |difference, (a, b)| difference | (a ^ b) }.zero?
  end

  def verify_origin!(request)
    origin = request['Origin'].to_s
    expected = @origin || "#{@production ? 'https' : 'http'}://#{request['host']}"
    unless !origin.empty? && origin == expected
      raise AppError.new('This request could not be verified. Refresh the page and try again.', status: 403, code: 'origin_check_failed')
    end
  end

  def enforce_rate_limit!(request)
    ip = request.respond_to?(:peeraddr) ? request.peeraddr[3] : 'unknown'
    unless @auth_limiter.allow?(ip)
      raise AppError.new('Too many sign-in attempts. Wait a few minutes and try again.', status: 429, code: 'rate_limited')
    end
  end

  def json_body(request)
    return {} if request.body.nil? || request.body.empty?
    if request.body.bytesize > MAX_JSON_BYTES
      raise AppError.new('This request is too large.', status: 413, code: 'payload_too_large')
    end
    content_type = request['Content-Type'].to_s.split(';').first
    raise AppError.new('Use a JSON request.', status: 415, code: 'unsupported_media_type') unless content_type == 'application/json'
    value = JSON.parse(request.body)
    raise AppError.new('Expected a JSON object.', status: 400, code: 'invalid_json') unless value.is_a?(Hash)
    value
  rescue JSON::ParserError
    raise AppError.new('That request is not valid JSON.', status: 400, code: 'invalid_json')
  end

  def serve_static(request, response)
    unless %w[GET HEAD].include?(request.request_method)
      response['Allow'] = 'GET, HEAD'
      raise AppError.new('This method is not available for static files.', status: 405, code: 'method_not_allowed')
    end
    relative = request.path == '/' ? 'index.html' : request.path.sub(%r{\A/}, '')
    path = File.expand_path(relative, @public_dir)
    unless path.start_with?(@public_dir + File::SEPARATOR) && File.file?(path) && !relative.split('/').any? { |part| part.start_with?('.') }
      response.status = 404
      response['Content-Type'] = 'text/plain; charset=utf-8'
      response.body = request.request_method == 'HEAD' ? '' : 'Not found'
      return
    end
    response['Content-Type'] = content_type(path)
    response['Cache-Control'] = cache_policy(path)
    response['Last-Modified'] = File.mtime(path).httpdate
    response['Service-Worker-Allowed'] = '/' if File.basename(path) == 'service-worker.js'
    response.body = request.request_method == 'HEAD' ? '' : File.binread(path)
  end

  def content_type(path)
    case File.extname(path)
    when '.html' then 'text/html; charset=utf-8'
    when '.css' then 'text/css; charset=utf-8'
    when '.js' then 'text/javascript; charset=utf-8'
    when '.json', '.webmanifest' then 'application/manifest+json; charset=utf-8'
    when '.svg' then 'image/svg+xml'
    when '.ico' then 'image/x-icon'
    when '.png' then 'image/png'
    when '.jpg', '.jpeg' then 'image/jpeg'
    when '.webp' then 'image/webp'
    else 'application/octet-stream'
    end
  end

  def cache_policy(path)
    %w[.html .css .js .json .webmanifest].include?(File.extname(path)) ? 'no-cache' : 'public, max-age=86400'
  end

  def set_security_headers(response)
    response['X-Content-Type-Options'] = 'nosniff'
    response['X-Frame-Options'] = 'DENY'
    response['Referrer-Policy'] = 'strict-origin-when-cross-origin'
    response['Permissions-Policy'] = 'camera=(), microphone=(), geolocation=()'
    # The pinned WebGL story streams its plant and HDRI from documented,
    # permissive public hosts. Keep every other connection same-origin while
    # allowing Three.js to fetch those two runtime assets directly.
    response['Content-Security-Policy'] = "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https://dl.polyhaven.org; connect-src 'self' https://cdn.jsdelivr.net https://raw.githubusercontent.com https://threejs.org https://dl.polyhaven.org; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'"
    response['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains' if @production
  end

  def json_response(response, status, payload)
    response.status = status
    response['Content-Type'] = 'application/json; charset=utf-8'
    response.body = JSON.generate(payload)
  end

  def log_error(label, error)
    @logger&.warn("#{label}: #{error.class}")
  end
end

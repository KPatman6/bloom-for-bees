require "json"
require "tmpdir"
require "fileutils"
require "minitest/autorun"
require_relative "../lib/api_app"

class FakeRequest
  attr_reader :path, :request_method, :body

  def initialize(method, path, headers = {}, body = nil)
    @request_method = method
    @path = path
    @headers = {}
    headers.each { |key, value| @headers[key.downcase] = value }
    @body = body
  end

  def [](key)
    @headers[key.to_s.downcase]
  end

  def peeraddr
    ["AF_INET", 0, "localhost", "127.0.0.1"]
  end
end

class FakeResponse
  attr_accessor :status, :body
  attr_reader :headers

  def initialize
    @status = 200
    @headers = {}
  end

  def [](key)
    @headers[key]
  end

  def []=(key, value)
    @headers[key] = value
  end
end

class BloomApiTest < Minitest::Test
  ORIGIN = "http://127.0.0.1:8000".freeze
  PASSWORD = "garden-blooms-2026".freeze

  def setup
    @directory = Dir.mktmpdir("bloom-for-bees-test")
    @app = ApiApp.new(
      public_dir: File.expand_path("../public", __dir__),
      database_path: File.join(@directory, "test.sqlite3")
    )
  end

  def teardown
    FileUtils.remove_entry(@directory) if @directory && File.directory?(@directory)
  end

  def request(method, path, payload: nil, cookie: nil, csrf: nil, origin: ORIGIN)
    headers = { "Host" => "127.0.0.1:8000" }
    headers["Origin"] = origin if origin
    headers["Content-Type"] = "application/json" if payload
    headers["Cookie"] = cookie if cookie
    headers["X-CSRF-Token"] = csrf if csrf
    body = payload ? JSON.generate(payload) : nil
    response = FakeResponse.new
    @app.handle(FakeRequest.new(method, path, headers, body), response)
    response
  end

  def payload(response)
    JSON.parse(response.body)
  end

  def register(email, name: "Bee Gardener")
    response = request("POST", "/api/auth/register", payload: {
      "name" => name,
      "email" => email,
      "password" => PASSWORD
    })
    assert_equal 200, response.status, response.body
    cookie = response["Set-Cookie"].split(";").first
    [payload(response), cookie]
  end

  def test_signup_stores_only_a_password_hash_and_session_is_private
    auth, cookie = register("one@example.test")
    assert_equal "Bee Gardener", auth.dig("user", "name")
    refute auth.dig("user").key?("password_hash")
    user = @app.instance_variable_get(:@database).user_by_email("one@example.test")
    refute_equal PASSWORD, user["password_hash"]
    assert_equal 64, user["password_hash"].length

    session = request("GET", "/api/session", cookie: cookie)
    assert_equal 200, session.status
    assert_equal auth.dig("user", "id"), payload(session).dig("user", "id")
    assert_equal auth["csrfToken"], payload(session)["csrfToken"]
  end

  def test_garden_create_update_delete_and_owner_isolation
    first, first_cookie = register("first@example.test")
    second, second_cookie = register("second@example.test")
    garden = {
      "flower" => "Bee balm",
      "place" => "A pot or window box",
      "sunlight" => "Part shade",
      "notes" => "Ask before using the shared patio.",
      "targetDate" => "2027-06-07",
      "planted" => false
    }
    created = request("POST", "/api/garden", payload: garden, cookie: first_cookie, csrf: first["csrfToken"])
    assert_equal 201, created.status, created.body
    id = payload(created).dig("garden", "id")

    other_list = request("GET", "/api/garden", cookie: second_cookie)
    assert_empty payload(other_list)["gardens"]
    forbidden_update = request("PATCH", "/api/garden/" + id, payload: { "planted" => true }, cookie: second_cookie, csrf: second["csrfToken"])
    assert_equal 404, forbidden_update.status

    binary_path = ("/api/garden/" + id).dup.force_encoding(Encoding::ASCII_8BIT)
    updated = request("PATCH", binary_path, payload: { "planted" => true }, cookie: first_cookie, csrf: first["csrfToken"])
    assert_equal 200, updated.status
    assert_equal true, payload(updated).dig("garden", "planted")
    assert_equal "2027-06-07", payload(updated).dig("garden", "targetDate")

    removed = request("DELETE", "/api/garden/" + id, payload: {}, cookie: first_cookie, csrf: first["csrfToken"])
    assert_equal 200, removed.status
    assert_empty payload(request("GET", "/api/garden", cookie: first_cookie))["gardens"]
  end

  def test_mutations_require_csrf_and_same_origin
    auth, cookie = register("csrf@example.test")
    garden = {
      "flower" => "Calendula",
      "place" => "My garden",
      "sunlight" => "Full sun",
      "notes" => "",
      "targetDate" => nil,
      "planted" => false
    }
    no_token = request("POST", "/api/garden", payload: garden, cookie: cookie)
    assert_equal 403, no_token.status
    wrong_origin = request("POST", "/api/garden", payload: garden, cookie: cookie, csrf: auth["csrfToken"], origin: "https://example.invalid")
    assert_equal 403, wrong_origin.status
    assert_equal "origin_check_failed", payload(wrong_origin)["code"]
  end

  def test_settings_profile_and_password_flows
    auth, cookie = register("settings@example.test")
    csrf = auth["csrfToken"]
    saved = request("PUT", "/api/settings", payload: {
      "theme" => "dark",
      "reminderEnabled" => true,
      "reminderDate" => "2027-06-07"
    }, cookie: cookie, csrf: csrf)
    assert_equal 200, saved.status
    assert_equal "dark", payload(saved).dig("settings", "theme")
    assert_equal true, payload(saved).dig("settings", "reminderEnabled")

    profile = request("PATCH", "/api/profile", payload: {
      "name" => "Garden Friend",
      "email" => "new-settings@example.test"
    }, cookie: cookie, csrf: csrf)
    assert_equal 200, profile.status
    assert_equal "new-settings@example.test", payload(profile).dig("user", "email")

    changed = request("POST", "/api/auth/password", payload: {
      "currentPassword" => PASSWORD,
      "newPassword" => "new-garden-password-2027"
    }, cookie: cookie, csrf: csrf)
    assert_equal 200, changed.status, changed.body
    new_cookie = changed["Set-Cookie"].split(";").first
    assert_nil payload(request("GET", "/api/session", cookie: cookie))["user"]
    assert_equal "Garden Friend", payload(request("GET", "/api/session", cookie: new_cookie)).dig("user", "name")
  end

  def test_account_delete_requires_matching_email_confirmation
    auth, cookie = register("remove@example.test")
    wrong = request("DELETE", "/api/account", payload: { "confirmation" => "wrong@example.test" }, cookie: cookie, csrf: auth["csrfToken"])
    assert_equal 422, wrong.status
    correct = request("DELETE", "/api/account", payload: { "confirmation" => "remove@example.test" }, cookie: cookie, csrf: auth["csrfToken"])
    assert_equal 200, correct.status
    assert_nil payload(request("GET", "/api/session", cookie: cookie))["user"]
  end

  def test_static_security_headers_and_path_traversal
    page = request("GET", "/")
    assert_equal 200, page.status
    assert_equal "DENY", page["X-Frame-Options"]
    assert_includes page["Content-Security-Policy"], "default-src 'self'"
    assert_equal "text/html; charset=utf-8", page["Content-Type"]
    assert_equal 404, request("GET", "/../server.rb").status
    assert_equal 401, request("GET", "/api/garden").status
  end
end

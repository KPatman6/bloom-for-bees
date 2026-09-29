require 'webrick'
require_relative 'lib/api_app'

class BloomApiServlet < WEBrick::HTTPServlet::AbstractServlet
  def initialize(server, app)
    super(server)
    @app = app
  end

  %w[GET HEAD POST PUT PATCH DELETE].each do |method|
    define_method("do_#{method}") do |request, response|
      @app.handle(request, response)
    end
  end
end

root = File.expand_path(__dir__)
public_dir = File.join(root, 'public')
database_path = ENV['BLOOM_DB_PATH'] || File.join(root, 'data', 'bloom.sqlite3')
production = ENV['APP_ENV'] == 'production'
origin = ENV['APP_ORIGIN']
port = Integer(ENV.fetch('PORT', '8000'))
host = ENV.fetch('HOST', '127.0.0.1')
logger = WEBrick::Log.new($stderr, WEBrick::Log::WARN)
app = ApiApp.new(public_dir: public_dir, database_path: database_path, production: production, origin: origin, logger: logger)

server = WEBrick::HTTPServer.new(
  BindAddress: host,
  Port: port,
  AccessLog: [],
  Logger: logger,
  DoNotReverseLookup: true,
  MaxClients: 32
)
server.mount('/', BloomApiServlet, app)
trap('INT') { server.shutdown }
trap('TERM') { server.shutdown }
puts "Bloom for Bees is running at http://#{host}:#{port}"
server.start

require 'thread'
require 'time'

class RateLimiter
  def initialize(limit:, window_seconds:)
    @limit = limit
    @window_seconds = window_seconds
    @attempts = Hash.new { |hash, key| hash[key] = [] }
    @mutex = Mutex.new
  end

  def allow?(key)
    now = Time.now.to_i
    @mutex.synchronize do
      attempts = @attempts[key]
      attempts.reject! { |timestamp| timestamp <= now - @window_seconds }
      return false if attempts.length >= @limit
      attempts << now
      @attempts.delete_if { |_bucket, values| values.empty? }
      true
    end
  end
end

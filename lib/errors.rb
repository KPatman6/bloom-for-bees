class AppError < StandardError
  attr_reader :status, :code

  def initialize(message, status: 400, code: 'request_error')
    super(message)
    @status = status
    @code = code
  end
end

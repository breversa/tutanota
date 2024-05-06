public class CancelledError: TutanotaError {
	public init(message: String, underlyingError: Error) { super.init(message: message, underlyingError: underlyingError) }

	public override var name: String { get { "de.tutao.tutanota.CancelledError" } }
}

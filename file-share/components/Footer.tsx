export default function Footer() {
  return (
    <footer className="border-t border-gray-200 bg-gray-50">
      <div className="mx-auto flex max-w-7xl flex-col items-center justify-center gap-1 px-4 py-4 text-sm text-gray-500 sm:flex-row sm:gap-6 sm:px-6 lg:px-8">
        <p>
          Created by{' '}
          <a
            href="https://8examples.com"
            target="_blank"
            rel="noopener"
            className="font-medium text-gray-700 hover:text-indigo-600 hover:underline"
          >
            8examples.com
          </a>
        </p>
        <p>
          Hosted by{' '}
          <a
            href="https://swiftgrid.net"
            target="_blank"
            rel="noopener"
            className="font-medium text-gray-700 hover:text-indigo-600 hover:underline"
          >
            SwiftGrid.net
          </a>
        </p>
      </div>
    </footer>
  );
}

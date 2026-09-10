class Supercheck < Formula
  desc "CLI for Supercheck test automation and monitoring"
  homepage "https://supercheck.io"
  url "https://registry.npmjs.org/@supercheck/cli/-/cli-0.1.0.tgz"
  sha256 "PLACEHOLDER_SHA256"
  license "AGPL-3.0-only"

  depends_on "node@20"

  def install
    system "npm", "install", *std_npm_args
    bin.install_symlink libexec/"bin/supercheck"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/supercheck --version")
    assert_match "ok", shell_output("#{bin}/supercheck health 2>&1", 1)
  end
end

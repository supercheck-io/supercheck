# Support

## Getting Help

### Documentation

- **[README](README.md)** - Quick start and overview
- **[Contributing Guide](CONTRIBUTING.md)** - Development setup

### Community

- **[GitHub Discussions](https://github.com/supercheck-io/supercheck/discussions)** - Ask questions and share ideas
- **[GitHub Issues](https://github.com/supercheck-io/supercheck/issues)** - Report bugs or request features

### Issue Templates

- **[Bug Report](https://github.com/supercheck-io/supercheck/issues/new?assignees=&labels=bug&template=bug_report.md)**
- **[Feature Request](https://github.com/supercheck-io/supercheck/issues/new?assignees=&labels=enhancement&template=feature_request.md)**

## Troubleshooting

### Services Not Starting

```bash
# Check logs
docker-compose logs app
docker-compose logs worker

# Restart services
docker-compose down
docker-compose up -d
```

### Database Issues

```bash
# Check PostgreSQL
docker-compose logs postgres

# Reset database (removes all data)
docker-compose down -v
docker-compose up -d
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development guidelines.

## Code of Conduct

See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) for community standards.

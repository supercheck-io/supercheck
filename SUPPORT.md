# Support

## Getting Help

- **Documentation**: [README](README.md) | [CONTRIBUTING](CONTRIBUTING.md)
- **Discussions**: [GitHub Discussions](https://github.com/supercheck-io/supercheck/discussions)
- **Bug Reports**: [GitHub Issues](https://github.com/supercheck-io/supercheck/issues)

## Quick Troubleshooting

```bash
# View logs
docker-compose logs app worker

# Restart services
docker-compose restart

# Reset environment (removes all data)
docker-compose down -v && docker-compose up -d
```

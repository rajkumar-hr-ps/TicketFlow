.PHONY: help install run seed test reset-data

NODE = node
NPM = npm
PORT ?= 3000

help:
	@echo "Available commands:"
	@echo "  make install           - Install Node.js dependencies"
	@echo "  make run               - Seed database and start the Express server (port $(PORT))"
	@echo "  make seed              - Seed the database with initial data (users, venues, events)"
	@echo "  make test              - Install deps and run all test suites"
	@echo "  make test FEATURE=1    - Install deps and run tests for a specific task (1-16)"
	@echo "  make reset-data        - Reset MongoDB database and flush Redis"

install:
	@echo "Installing dependencies..."
	@$(NPM) install
	@echo ""
	@echo "Installation complete!"
	@echo ""
	@echo "Quick Start:"
	@echo "  make run                  # Seed + start Express server"
	@echo "  make test FEATURE=1       # Run task 1 tests"

run: install seed
	@echo "Starting Express server on port $(PORT)..."
	@$(NODE) src/server.js

seed:
	@echo "Seeding database with initial data..."
	@$(NODE) src/seed.js

test: install
ifdef FEATURE
	@echo "Running tests for feature: $(FEATURE)"
	@rm -rf output
	@mkdir -p output
	@$(NPM) run test:task$(FEATURE)
else
	@echo "Running all tests..."
	@rm -rf output
	@mkdir -p output
	@$(NPM) test
endif

reset-data:
	@$(NODE) src/reset.js

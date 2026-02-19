.PHONY: help install run dev seed test test-all reset-data clean check-services

NODE = node
NPM = npm
PORT ?= 3000

help:
	@echo "Available commands:"
	@echo "  make install        - Install Node.js dependencies"
	@echo "  make run            - Start the Express server (port $(PORT))"
	@echo "  make dev            - Start the Express server in watch/dev mode"
	@echo "  make seed           - Seed the database with initial data (users, venues, events)"
	@echo "  make test TASK=1    - Run tests for a specific task (1-16)"
	@echo "  make test-all       - Run all test suites"
	@echo "  make reset-data     - Reset MongoDB database and flush Redis"
	@echo "  make check-services - Check if MongoDB and Redis are running"
	@echo "  make clean          - Clean up everything (node_modules, reports, logs)"

install:
	@echo "Installing dependencies..."
	@$(NPM) install
	@echo ""
	@echo "Installation complete!"
	@echo ""
	@echo "Quick Start:"
	@echo "  make run               # Start Express server"
	@echo "  make dev               # Start in watch mode"
	@echo "  make test TASK=1       # Run task 1 tests"
	@echo ""
	@echo "Make sure MongoDB and Redis are running:"
	@echo "  make check-services"

run:
	@echo "Checking for processes on port $(PORT)..."
	@lsof -ti:$(PORT) | xargs kill -9 2>/dev/null || true
	@sleep 1
	@echo "Starting Express server on port $(PORT)..."
	@$(NODE) src/server.js

dev:
	@echo "Checking for processes on port $(PORT)..."
	@lsof -ti:$(PORT) | xargs kill -9 2>/dev/null || true
	@sleep 1
	@echo "Starting Express server in watch mode on port $(PORT)..."
	@$(NODE) --watch src/server.js

seed:
	@echo "Seeding database with initial data..."
	@$(NODE) src/seed.js

test:
ifndef TASK
	@echo "Error: Please specify a task number. Usage: make test TASK=1"
	@exit 1
endif
	@echo "Running tests for task: $(TASK)"
	@rm -rf output
	@mkdir -p output
	@$(NPM) run test:task$(TASK)

test-all: install
	@echo "Running all tests..."
	@rm -rf output
	@mkdir -p output
	@$(NPM) test

reset-data:
	@echo "Resetting database and cache..."
	@echo "  - Dropping MongoDB ticketflow database..."
	@mongosh --quiet --eval 'db.getSiblingDB("ticketflow").dropDatabase()' 2>/dev/null || \
		mongo --quiet --eval 'db.getSiblingDB("ticketflow").dropDatabase()' 2>/dev/null || \
		echo "  Warning: Could not connect to MongoDB. Is it running?"
	@echo "  - Dropping MongoDB ticketflow_test database..."
	@mongosh --quiet --eval 'db.getSiblingDB("ticketflow_test").dropDatabase()' 2>/dev/null || \
		mongo --quiet --eval 'db.getSiblingDB("ticketflow_test").dropDatabase()' 2>/dev/null || true
	@echo "  - Flushing Redis..."
	@redis-cli FLUSHALL 2>/dev/null || echo "  Warning: Could not connect to Redis. Is it running?"
	@echo ""
	@echo "Reset complete! Run 'make run' to start fresh."

check-services:
	@echo "Checking services..."
	@echo ""
	@printf "  MongoDB: "
	@mongosh --quiet --eval 'db.runCommand({ ping: 1 }).ok' 2>/dev/null && echo "running" || \
		(mongo --quiet --eval 'db.runCommand({ ping: 1 }).ok' 2>/dev/null && echo "running" || echo "NOT running")
	@printf "  Redis:   "
	@redis-cli ping 2>/dev/null || echo "NOT running"
	@echo ""

clean:
	@echo "Cleaning up everything..."
	@echo "  - Removing node_modules..."
	@rm -rf node_modules
	@echo "  - Removing test artifacts..."
	@rm -rf output
	@rm -rf reports
	@rm -rf .nyc_output
	@rm -rf coverage
	@rm -rf .mocha*
	@echo "  - Removing log files..."
	@rm -rf *.log
	@rm -rf logs/
	@echo "  - Removing OS artifacts..."
	@rm -rf .DS_Store
	@find . -name ".DS_Store" -delete 2>/dev/null || true
	@echo ""
	@echo "Cleanup complete! Project is now pristine."
	@echo "  Run 'make install' to set up again."

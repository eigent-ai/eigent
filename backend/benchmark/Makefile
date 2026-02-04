.PHONY: clean clean-browser-logs clean-camel-logs clean-working-dirs

BROWSER_LOG_DIR := $(abspath ../browser_log)
CAMEL_LOG_DIR := $(HOME)/.eigent/benchmark
WORKING_DIR := $(HOME)/eigent/benchmark

clean: clean-browser-logs clean-camel-logs clean-working-dirs
	@echo "All benchmark artifacts cleaned."

clean-browser-logs:
	@echo "Cleaning browser logs: $(BROWSER_LOG_DIR)"
	rm -rf $(BROWSER_LOG_DIR)

clean-camel-logs:
	@echo "Cleaning camel logs: $(CAMEL_LOG_DIR)"
	rm -rf $(CAMEL_LOG_DIR)/project_benchmark_*

clean-working-dirs:
	@echo "Cleaning benchmark working dirs: $(WORKING_DIR)"
	rm -rf $(WORKING_DIR)/project_benchmark_*

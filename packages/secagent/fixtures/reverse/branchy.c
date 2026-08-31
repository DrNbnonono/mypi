#include <stdio.h>
#include <string.h>

static int classify(const char *value) {
	if (strcmp(value, "fixture-admin") == 0) return 7;
	if (strncmp(value, "fixture-", 8) == 0) return 3;
	return 0;
}

int main(void) {
	const char *value = "fixture-user";
	printf("class=%d\n", classify(value));
	return 0;
}

#include <stdio.h>
#include <string.h>

/* Deliberately unsafe code for static-analysis training only. It is never
 * invoked by the container entry point and accepts no network input. */
void vulnerable_copy(const char *input) {
	char buffer[32];
	strcpy(buffer, input);
	puts(buffer);
}

int main(void) {
	vulnerable_copy("controlled-fixture");
	return 0;
}

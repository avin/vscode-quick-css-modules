import React from 'react';
import styles from './TestComponent.module.scss';

export const TestComponent = () => {
	return (
		<div className={styles.container}>
			<h1 className={styles.title}>Test</h1>
			<div className={styles.newClass}>New class test</div>
		</div>
	);
};

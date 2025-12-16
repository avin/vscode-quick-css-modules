import React from 'react';
import styles from './MultiRename.module.scss';

export const Component = () => {
	return (
		<>
			<div className={styles.myClass}>First</div>
			<span className={styles.myClass}>Second</span>
			<p className={styles.myClass}>Third</p>
		</>
	);
};
